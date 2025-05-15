// Importation des modules nécessaires
import dotenv from 'dotenv';
import Airtable from 'airtable';
import { generateInvoice } from './sellsy.js';
import { formatDate, calculateDueDate } from './utils.js';

// Chargement des variables d'environnement
dotenv.config();

// Configuration d'Airtable
const base = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY
}).base(process.env.AIRTABLE_BASE_ID);

// Tables Airtable
const abonnementsTable = base('Abonnements');
const serviceTable = base('service_sellsy');

/**
 * Fonction principale qui s'exécute quotidiennement
 */
async function main() {
  console.log('🚀 Démarrage de la vérification des factures à générer...');

  try {
    // 1. Récupérer tous les abonnements actifs
    const abonnements = await getActiveSubscriptions();
    console.log(`📋 ${abonnements.length} abonnements actifs trouvés`);

    // 2. Pour chaque abonnement, vérifier si une facture doit être générée aujourd'hui
    let invoicesGenerated = 0;

    for (const abonnement of abonnements) {
      const invoiceNeeded = checkIfInvoiceNeeded(abonnement);
      
      if (!invoiceNeeded) continue;

      // 3. Si oui, générer la facture dans Sellsy
      const services = await getServicesForSubscription(abonnement);
      
      if (services.length === 0) {
        console.warn(`⚠️ Aucun service trouvé pour l'abonnement ID ${abonnement.id}`);
        continue;
      }

      await generateInvoicesForServices(abonnement, services);
      invoicesGenerated++;
    }

    console.log(`✅ Traitement terminé. ${invoicesGenerated} factures générées.`);
  } catch (error) {
    console.error('❌ Erreur lors du traitement:', error);
  }
}

/**
 * Récupère tous les abonnements actifs
 */
async function getActiveSubscriptions() {
  return new Promise((resolve, reject) => {
    const abonnements = [];
    
    abonnementsTable.select({
      filterByFormula: "Statut='Actif'",
      view: "Grid view"
    }).eachPage(
      function page(records, fetchNextPage) {
        records.forEach(record => {
          abonnements.push({
            id: record.id,
            fields: record.fields
          });
        });
        fetchNextPage();
      },
      function done(err) {
        if (err) {
          reject(err);
        } else {
          resolve(abonnements);
        }
      }
    );
  });
}

/**
 * Vérifie si une facture doit être générée aujourd'hui pour cet abonnement
 */
function checkIfInvoiceNeeded(abonnement) {
  // Récupérer le jour de facturation configuré (1-31)
  const jourFacturation = abonnement.fields['Jour de facturation'];
  
  if (!jourFacturation) {
    console.warn(`⚠️ Jour de facturation non défini pour l'abonnement ID ${abonnement.id}`);
    return false;
  }

  // Date d'aujourd'hui
  const today = new Date();
  const currentDay = today.getDate();
  
  // Vérifier si c'est le jour de facturation
  return currentDay === parseInt(jourFacturation);
}

/**
 * Récupère les services liés à un abonnement
 */
async function getServicesForSubscription(abonnement) {
  // Récupérer les IDs des services liés
  const servicesLies = abonnement.fields['Services liés'] || [];
  
  if (servicesLies.length === 0) {
    return [];
  }
  
  // Récupérer les détails des services
  const services = [];
  
  for (const serviceId of servicesLies) {
    try {
      const service = await serviceTable.find(serviceId);
      
      // Vérifier si le service est actif et si c'est un abonnement
      if (service.fields['Actif'] === 'Actif' && service.fields['Catégorie'] === 'Abonnement') {
        // S'assurer que le service appartient bien au même client
        const serviceClientId = service.fields['ID_Sellsy_abonné'] || '';
        const abonnementClientId = abonnement.fields['ID_Sellsy_abonné'] || '';
        
        if (serviceClientId && abonnementClientId && serviceClientId === abonnementClientId) {
          services.push({
            id: service.id,
            fields: service.fields
          });
        } else {
          console.warn(`⚠️ Service ID ${serviceId}: ID client incohérent avec l'abonnement`);
        }
      }
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération du service ID ${serviceId}:`, error);
    }
  }
  
  return services;
}

/**
 * Génère les factures pour les services et met à jour les occurrences
 */
async function generateInvoicesForServices(abonnement, services) {
  const idSellsyClient = abonnement.fields['ID_Sellsy_abonné'];
  
  if (!idSellsyClient) {
    console.warn(`⚠️ ID Sellsy client non défini pour l'abonnement ID ${abonnement.id}`);
    return;
  }
  
  for (const service of services) {
    const occurrencesRestantes = service.fields['Occurrences restantes'] || 0;
    
    // Ne pas facturer si plus d'occurrences restantes
    if (occurrencesRestantes <= 0) {
      console.log(`ℹ️ Service ID ${service.id}: Pas d'occurrences restantes, aucune facture générée`);
      continue;
    }
    
    // Générer la facture dans Sellsy
    try {
      // Récupérer les informations du service
      const serviceInfo = {
        clientId: idSellsyClient,
        serviceId: service.fields['ID Sellsy'],
        serviceName: service.fields['Nom du service'],
        price: service.fields['Prix HT'],
        taxRate: service.fields['Taux TVA'] || 20,
        paymentMethod: 'gocardless'  // Toujours utiliser GoCardless
      };
      
      // Générer la facture
      const invoice = await generateInvoice(serviceInfo);
      
      console.log(`✅ Facture générée pour le service ${service.fields['Nom du service']} (ID: ${service.id})`);
      
      // Mettre à jour les occurrences restantes
      await updateServiceOccurrences(service.id);
    } catch (error) {
      console.error(`❌ Erreur lors de la génération de la facture pour le service ID ${service.id}:`, error);
    }
  }
}

/**
 * Met à jour les occurrences après génération d'une facture
 */
async function updateServiceOccurrences(serviceId) {
  try {
    // Récupérer le service
    const service = await serviceTable.find(serviceId);
    
    // Récupérer les valeurs actuelles
    const moisFactures = (service.fields['Mois facturés'] || 0) + 1;
    const occurrencesTotales = service.fields['Occurrences totales'] || 0;
    const nouvellesOccurrencesRestantes = Math.max(0, occurrencesTotales - moisFactures);
    
    // Mettre à jour le service
    await serviceTable.update(serviceId, {
      'Mois facturés': moisFactures,
      'Occurrences restantes': nouvellesOccurrencesRestantes
    });
    
    console.log(`✅ Service ID ${serviceId}: ${nouvellesOccurrencesRestantes}/${occurrencesTotales} occurrences restantes`);
  } catch (error) {
    console.error(`❌ Erreur lors de la mise à jour des occurrences pour le service ID ${serviceId}:`, error);
  }
}

// Exécution du programme principal
main();
