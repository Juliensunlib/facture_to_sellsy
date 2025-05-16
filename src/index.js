import dotenv from 'dotenv';
import Airtable from 'airtable';
import { generateInvoice, checkSellsyConnection } from './sellsy.js';
import { formatDate, calculateDueDate } from './utils.js';

dotenv.config();

// Vérification des variables d’environnement
const requiredEnv = [
  'AIRTABLE_API_KEY',
  'AIRTABLE_BASE_ID',
  'SELLSY_CLIENT_ID',
  'SELLSY_CLIENT_SECRET',
];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error(`❌ Variables d'environnement manquantes : ${missingEnv.join(', ')}`);
  process.exit(1);
}
console.log('✅ Variables d\'environnement chargées');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const abonnementsTable = base('Abonnements');
const servicesTable = base('service_sellsy');

async function main() {
  console.log('🚀 Lancement du traitement des factures...');

  try {
    if (!await checkSellsyConnection()) {
      throw new Error("❌ Connexion à l'API Sellsy impossible.");
    }

    const abonnements = await fetchAbonnementsActifs();
    console.log(`📦 ${abonnements.length} abonnements actifs`);

    let totalInvoices = 0;

    for (const abonnement of abonnements) {
      if (!shouldInvoiceToday(abonnement)) continue;

      const services = await fetchServicesForAbonnement(abonnement);
      if (!services.length) continue;

      const count = await generateInvoices(abonnement, services);
      totalInvoices += count;
    }

    console.log(`✅ ${totalInvoices} facture(s) générée(s) avec succès.`);
  } catch (err) {
    console.error('❌ Erreur principale :', err.message);
    process.exit(1);
  }
}

function shouldInvoiceToday(abonnement) {
  const today = new Date().getDate();
  const billingDay = parseInt(abonnement.fields['Jour de facturation'], 10);

  if (!billingDay || today !== billingDay) {
    console.log(`ℹ️ Abonnement ${abonnement.id} : pas de facturation aujourd'hui`);
    return false;
  }

  console.log(`✅ Abonnement ${abonnement.id} : facturation prévue aujourd'hui`);
  return true;
}

async function fetchAbonnementsActifs() {
  const records = await abonnementsTable.select({
    filterByFormula: `Statut = 'Actif'`,
    view: 'Grid view',
  }).all();

  return records.map((r) => ({ id: r.id, fields: r.fields }));
}

async function fetchServicesForAbonnement(abonnement) {
  const ids = abonnement.fields['Services liés'] || [];
  const clientSellsyId = abonnement.fields['ID_Sellsy_abonné'];
  if (!clientSellsyId || !ids.length) return [];

  const validServices = [];

  for (const id of ids) {
    try {
      const service = await servicesTable.find(id);
      const { fields } = service;

      if ((fields['Actif'] !== 'Actif' && fields['Actif'] !== true) ||
          fields['Catégorie'] !== 'Abonnement' ||
          fields['ID_Sellsy_abonné'] !== clientSellsyId) {
        continue;
      }

      validServices.push({ id: service.id, fields });
    } catch (err) {
      console.warn(`⚠️ Service ${id} non récupéré :`, err.message);
    }
  }

  return validServices;
}

async function generateInvoices(abonnement, services) {
  let count = 0;

  for (const service of services) {
    const { fields } = service;

    const occRestantes = fields['Occurrences restantes'] || 0;
    if (occRestantes <= 0) {
      console.log(`ℹ️ Service ${service.id} : aucune occurrence restante`);
      continue;
    }

    const sellsyServiceId = fields['ID Sellsy'];
    if (!sellsyServiceId) {
      console.warn(`⚠️ Service ${service.id} : ID Sellsy manquant`);
      continue;
    }

    const invoiceData = {
      clientId: abonnement.fields['ID_Sellsy_abonné'],
      serviceId: sellsyServiceId,
      serviceName: fields['Nom du service'],
      price: fields['Prix HT'],
      taxRate: fields['Taux TVA'] || 20,
      paymentMethod: 'prélèvement',
    };

    try {
      await generateInvoice(invoiceData);
      await decrementOccurrences(service.id);
      console.log(`✅ Facture créée pour service ${fields['Nom du service']} (${service.id})`);
      count++;
    } catch (err) {
      console.error(`❌ Erreur facturation service ${service.id} :`, err.message);
    }
  }

  return count;
}

async function decrementOccurrences(serviceId) {
  try {
    const record = await servicesTable.find(serviceId);
    const moisFactures = (record.fields['Mois facturés'] || 0) + 1;
    const totalOccurrences = record.fields['Occurrences totales'] || 0;
    const restants = Math.max(0, totalOccurrences - moisFactures);

    await servicesTable.update(serviceId, {
      'Mois facturés': moisFactures,
      'Occurrences restantes': restants,
    });

    console.log(`📉 Service ${serviceId} : ${restants}/${totalOccurrences} occurrences restantes`);
  } catch (err) {
    console.error(`❌ Erreur mise à jour occurrences (${serviceId}) :`, err.message);
  }
}

main();
