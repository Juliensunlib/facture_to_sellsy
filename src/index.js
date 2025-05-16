// Importation des modules nécessaires
import dotenv from 'dotenv';
import Airtable from 'airtable';
import { generateInvoice, checkSellsyConnection } from './sellsy.js';
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
 * Vérifie la présence et la validité des variables d'environnement
 */
function checkEnvironmentVariables() {
  const requiredVars = [
    'AIRTABLE_API_KEY',
    'AIRTABLE_BASE_ID',
    'SELLSY_CLIENT_ID',
    'SELLSY_CLIENT_SECRET'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Variables d'environnement manquantes: ${missingVars.join(', ')}`);
  }
  
  console.log('✅ Variables d\'environnement vérifiées avec succès');
}

/**
 * Fonction principale qui s'exécute quotidiennement
 */
async function main() {
  console.log('🚀 Démarrage de la vérification des factures à générer...');

  try {
    // Vérifier les variables d'environnement
    checkEnvironmentVariables();
    
    // Vérifier la connexion à l'API Sellsy
    const sellsyConnected = await checkSellsyConnection();
    if (!sellsyConnected) {
      throw new Error("Impossible d'établir une connexion avec l'API Sellsy. Vérifiez vos identifiants.");
    }

    // 1. Récupérer tous les abonnements actifs
    const abonnements = await getActiveSubscriptions();
    console.log(`📋 ${abonnements.length} abonnements actifs trouvés`);

    // 2. Pour chaque abonnement, vérifier si une facture doit être générée aujourd'hui
    let invoicesGenerated = 0;

    for (const abonnement of abonnements) {
      const invoiceNeeded = checkIfInvoiceNeeded(abonnement);
      
      if (!invoiceNeeded) {
        console.log(`ℹ️ Abonnement ID ${abonnement.id}: Pas de facturation prévue aujourd'hui`);
        continue;
      }

      console.log(`🔄 Traitement de l'abonnement ID ${abonnement.id}: ${abonnement.fields['Nom de l\'abonnement'] || 'Sans nom'}`);

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
    process.exit(1); // Sortir avec un code d'erreur
  }
}

/**
 * Récupère tous les abonnements actifs
 */
async function getActiveSubscriptions() {
  return new Promise((resolve, reject) => {
    console.log('🔄 Récupération des abonnements actifs...');
    
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
          console.error('❌ Erreur lors de la récupération des abonnements:', err);
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
  const shouldInvoice = currentDay === parseInt(jourFacturation);
  
  if (shouldInvoice) {
    console.log(`✅ Abonnement ID ${abonnement.id}: Jour de facturation (${jourFacturation}) correspond à aujourd'hui (${currentDay})`);
  } else {
    console.log(`ℹ️ Abonnement ID ${abonnement.id}: Jour de facturation (${jourFacturation}) ne correspond pas à aujourd'hui (${currentDay})`);
  }
  
  return shouldInvoice;
}

/**
 * Récupère les services liés à un abonnement
 * Version corrigée qui tient compte des références Airtable et des valeurs booléennes
 */
async function getServicesForSubscription(abonnement) {
  // Récupérer les IDs Airtable des services liés
  const serviceRecordIds = abonnement.fields['Services liés'] || [];
  
  console.log(`🔍 Services liés (IDs Airtable) pour l'abonnement ID ${abonnement.id}:`, serviceRecordIds);
  
  if (!serviceRecordIds.length) {
    console.warn(`⚠️ Aucun ID de service trouvé pour l'abonnement ID ${abonnement.id}`);
    return [];
  }
  
  // Récupérer l'ID du client Sellsy
  const idSellsyClient = abonnement.fields['ID_Sellsy_abonné'];
  
  if (!idSellsyClient) {
    console.warn(`⚠️ ID Sellsy client non défini pour l'abonnement ID ${abonnement.id}`);
    return [];
  }
  
  // Récupérer les services directement par leur ID Airtable
  const services = [];
  
  for (const recordId of serviceRecordIds) {
    try {
      // Récupérer le service directement par son ID Airtable
      console.log(`🔍 Récupération du service avec ID Airtable: ${recordId}`);
      const service = await serviceTable.find(recordId);
      
      console.log(`🔍 Service trouvé: ${service.fields['Nom du service'] || 'Sans nom'}`);
      console.log(`   - Statut: ${service.fields['Actif']}`);
      console.log(`   - Catégorie: ${service.fields['Catégorie'] || 'Non définie'}`);
      console.log(`   - ID Client Service: ${service.fields['ID_Sellsy_abonné'] || 'Non défini'}`);
      console.log(`   - ID Client Abonnement: ${idSellsyClient}`);
      console.log(`   - ID Sellsy Service: ${service.fields['ID Sellsy'] || 'Non défini'}`);
      
      // Vérifier si le service est actif (accepte à la fois "Actif" et true)
      if (service.fields['Actif'] !== 'Actif' && service.fields['Actif'] !== true) {
        console.warn(`⚠️ Service ${recordId}: n'est pas actif`);
        continue;
      }
      
      // Vérifier si c'est un abonnement
      if (service.fields['Catégorie'] !== 'Abonnement') {
        console.warn(`⚠️ Service ${recordId}: n'est pas de catégorie 'Abonnement' (${service.fields['Catégorie']})`);
        continue;
      }
      
      // Vérifier que le service appartient au même client
      const serviceClientId = service.fields['ID_Sellsy_abonné'] || '';
      
      if (!serviceClientId || serviceClientId !== idSellsyClient) {
        console.warn(`⚠️ Service ${recordId}: ID client incohérent avec l'abonnement`);
        continue;
      }
      
      // Service valide, l'ajouter à la liste
      services.push({
        id: service.id,
        fields: service.fields
      });
      
      console.log(`✅ Service valide ajouté: ${service.fields['Nom du service']}`);
      
    } catch (error) {
      console.error(`❌ Erreur lors de la récupération du service ${recordId}:`, error);
    }
  }
  
  console.log(`✅ Total de ${services.length} services valides trouvés pour l'abonnement ID ${abonnement.id}`);
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
    
    // Récupérer l'ID Sellsy du service
    const idSellsyService = service.fields['ID Sellsy'];
    if (!idSellsyService) {
      console.warn(`⚠️ ID Sellsy service non défini pour le service ID ${service.id}`);
      continue;
    }
    
    // Générer la facture dans Sellsy
    try {
      // Récupérer les informations du service
      const serviceInfo = {
        clientId: idSellsyClient,
        serviceId: idSellsyService,
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
