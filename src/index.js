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
 * Version corrigée qui recherche par ID Sellsy
 */
async function getServicesForSubscription(abonnement) {
  // Récupérer les IDs Sellsy des services liés
  const servicesIDs = abonnement.fields['Services liés'] || [];
  
  console.log(`🔍 Services liés pour l'abonnement ID ${abonnement.id}:`, servicesIDs);
  
  if (!servicesIDs.length) {
    console.warn(`⚠️ Aucun ID de service trouvé pour l'abonnement ID ${abonnement.id}`);
    return [];
  }
  
  // Récupérer l'ID du client Sellsy
  const idSellsyClient = abonnement.fields['ID_Sellsy_abonné'];
  
  if (!idSellsyClient) {
    console.warn(`⚠️ ID Sellsy client non défini pour l'abonnement ID ${abonnement.id}`);
    return [];
  }
  
  // Récupérer les services correspondant aux IDs Sellsy
  return new Promise((resolve, reject) => {
    const services = [];
    
    // Créer un tableau de promesses pour récupérer chaque service individuellement
    const servicePromises = servicesIDs.map(idSellsy => {
      return new Promise((resolveService, rejectService) => {
        serviceTable.select({
          filterByFormula: `AND({ID Sellsy} = '${idSellsy}', {ID_Sellsy_abonné} = '${idSellsyClient}', {Actif} = 'Actif', {Catégorie} = 'Abonnement')`,
          maxRecords: 1,
          view: "Grid view"
        }).firstPage((err, records) => {
          if (err) {
            console.error(`❌ Erreur lors de la recherche du service ID Sellsy ${idSellsy}:`, err);
            rejectService(err);
            return;
          }
          
          if (records && records.length > 0) {
            console.log(`✅ Service trouvé: ${records[0].fields['Nom du service']} (ID Sellsy: ${idSellsy})`);
            services.push({
              id: records[0].id,
              fields: records[0].fields
            });
          } else {
            console.warn(`⚠️ Aucun service actif trouvé pour l'ID Sellsy ${idSellsy}`);
          }
          
          resolveService();
        });
      });
    });
    
    // Attendre que toutes les requêtes de service soient terminées
    Promise.all(servicePromises)
      .then(() => {
        console.log(`✅ Total de ${services.length} services valides trouvés pour l'abonnement ID ${abonnement.id}`);
        resolve(services);
      })
      .catch(error => {
        console.error('❌ Erreur lors de la récupération des services:', error);
        reject(error);
      });
  });
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
