import dotenv from 'dotenv';
import Airtable from 'airtable';
import { generateInvoice, checkSellsyConnection } from './sellsy.js';
import { formatDate, calculateDueDate, isToday } from './utils.js';

dotenv.config();

// Vérification des variables d'environnement
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
      if (!services.length) {
        console.log(`ℹ️ Aucun service actif trouvé pour l'abonnement ${abonnement.id}`);
        continue;
      }

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

  // Vérifier si le jour de facturation est valide
  if (!billingDay || isNaN(billingDay) || billingDay < 1 || billingDay > 31) {
    console.warn(`⚠️ Abonnement ${abonnement.id} : jour de facturation invalide (${abonnement.fields['Jour de facturation']})`);
    return false;
  }

  // Cas spécial pour les mois avec moins de 31 jours - facturer le dernier jour du mois
  const currentDate = new Date();
  const lastDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  
  // Si on est le dernier jour du mois et le jour de facturation est supérieur au nombre de jours du mois
  if (today === lastDayOfMonth && billingDay > lastDayOfMonth) {
    console.log(`✅ Abonnement ${abonnement.id} : facturation effectuée le dernier jour du mois (${today}) car le jour configuré (${billingDay}) n'existe pas ce mois-ci`);
    return true;
  }

  if (today !== billingDay) {
    console.log(`ℹ️ Abonnement ${abonnement.id} : pas de facturation aujourd'hui (jour ${today}, jour de facturation configuré: ${billingDay})`);
    return false;
  }

  // Vérifier la date de début d'abonnement
  if (abonnement.fields['Date de début']) {
    const startDate = new Date(abonnement.fields['Date de début']);
    if (startDate > new Date()) {
      console.log(`ℹ️ Abonnement ${abonnement.id} : la date de début (${formatDate(startDate)}) est dans le futur`);
      return false;
    }
  }

  console.log(`✅ Abonnement ${abonnement.id} : facturation prévue aujourd'hui`);
  return true;
}

async function fetchAbonnementsActifs() {
  try {
    const records = await abonnementsTable.select({
      filterByFormula: `Statut = 'Actif'`,
      view: 'Grid view',
    }).all();

    return records.map((r) => ({ id: r.id, fields: r.fields }));
  } catch (err) {
    console.error('❌ Erreur lors de la récupération des abonnements actifs:', err.message);
    return [];
  }
}

async function fetchServicesForAbonnement(abonnement) {
  const ids = abonnement.fields['Services liés'] || [];
  const clientSellsyId = abonnement.fields['ID_Sellsy_abonné'];
  
  if (!clientSellsyId) {
    console.warn(`⚠️ Abonnement ${abonnement.id} : ID_Sellsy_abonné manquant`);
    return [];
  }
  
  if (!ids.length) {
    console.warn(`⚠️ Abonnement ${abonnement.id} : aucun service lié`);
    return [];
  }

  const validServices = [];

  for (const id of ids) {
    try {
      const service = await servicesTable.find(id);
      const { fields } = service;

      // Vérifier si le service est actif et de catégorie Abonnement
      if ((fields['Actif'] !== 'Actif' && fields['Actif'] !== true) ||
          fields['Catégorie'] !== 'Abonnement') {
        console.log(`ℹ️ Service ${id} ignoré: ${!fields['Actif'] ? 'inactif' : 'pas un abonnement'}`);
        continue;
      }

      // Vérifier que le service correspond au même client que l'abonnement
      if (fields['ID_Sellsy_abonné'] !== clientSellsyId) {
        console.warn(`⚠️ Service ${id} : ID_Sellsy_abonné (${fields['ID_Sellsy_abonné']}) ne correspond pas à l'abonnement (${clientSellsyId})`);
        continue;
      }

      // Vérifier qu'il reste des occurrences à facturer
      const occRestantes = fields['Occurrences restantes'] !== undefined ? parseInt(fields['Occurrences restantes'], 10) : 0;
      if (isNaN(occRestantes) || occRestantes <= 0) {
        console.log(`ℹ️ Service ${id} ignoré: aucune occurrence restante (${fields['Occurrences restantes']})`);
        continue;
      }

      // Vérifier que le service a un ID Sellsy valide
      if (!fields['ID Sellsy']) {
        console.warn(`⚠️ Service ${id} : ID Sellsy manquant`);
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
  const clientId = abonnement.fields['ID_Sellsy_abonné'];
  const abonnementName = abonnement.fields['Nom de l\'abonnement'] || 'Abonnement sans nom';

  console.log(`📝 Génération des factures pour l'abonnement "${abonnementName}" (client ${clientId})`);

  for (const service of services) {
    const { fields } = service;

    // Ces vérifications sont redondantes avec fetchServicesForAbonnement, mais assurent la cohérence
    const occRestantes = parseInt(fields['Occurrences restantes'] || '0', 10);
    if (isNaN(occRestantes) || occRestantes <= 0) {
      console.log(`ℹ️ Service ${service.id} : aucune occurrence restante`);
      continue;
    }

    const sellsyServiceId = fields['ID Sellsy'];
    if (!sellsyServiceId) {
      console.warn(`⚠️ Service ${service.id} : ID Sellsy manquant`);
      continue;
    }

    // Préparer les données pour la facture
    const invoiceData = {
      clientId: clientId,
      serviceId: sellsyServiceId,
      serviceName: fields['Nom du service'],
      price: fields['Prix HT'],
      taxRate: fields['Taux TVA'] || 20,
      paymentMethod: 'prélèvement', // Méthode configurée pour GoCardless
    };

    try {
      // Générer la facture avec prélèvement GoCardless
      const invoice = await generateInvoice(invoiceData);
      
      if (invoice && invoice.id) {
        // Mettre à jour les compteurs d'occurrences uniquement si la facture a été créée
        await decrementOccurrences(service.id);
        console.log(`✅ Facture ${invoice.id} créée pour service "${fields['Nom du service']}" (${service.id})`);
        count++;
      } else {
        console.warn(`⚠️ Facture non créée pour service ${service.id} : réponse inattendue de l'API`);
      }
    } catch (err) {
      console.error(`❌ Erreur facturation service ${service.id} :`, err.message);
    }
  }

  return count;
}

async function decrementOccurrences(serviceId) {
  try {
    const record = await servicesTable.find(serviceId);
    
    // Récupérer les valeurs actuelles avec conversion en nombre
    const moisFactures = parseInt(record.fields['Mois facturés'] || '0', 10) + 1;
    const totalOccurrences = parseInt(record.fields['Occurrences totales'] || '0', 10);
    
    // Calculer les occurrences restantes
    const restants = Math.max(0, totalOccurrences - moisFactures);

    // Mettre à jour les compteurs dans Airtable
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
