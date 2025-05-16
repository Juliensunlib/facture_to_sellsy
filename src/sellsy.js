// Module d'intégration avec l'API Sellsy V2
import axios from 'axios';

// URL de base pour l'API Sellsy V2
const SELLSY_API_URL = 'https://api.sellsy.com/v2';
const SELLSY_OAUTH_URL = 'https://login.sellsy.com/oauth2/access-tokens';

// Stockage du token d'accès
let accessToken = null;
let tokenExpiration = null;

/**
 * Obtient un token d'accès pour l'API Sellsy
 * @param {number} retryCount - Le nombre de tentatives déjà effectuées
 * @returns {Promise<string>} - Le token d'accès
 */
async function getAccessToken(retryCount = 0) {
  if (accessToken && tokenExpiration && tokenExpiration > Date.now()) {
    return accessToken;
  }
  const MAX_RETRIES = 3;
  try {
    console.log("🔄 Obtention d'un nouveau token d'accès Sellsy...");
    const requestData = {
      grant_type: 'client_credentials',
      client_id: process.env.SELLSY_CLIENT_ID,
      client_secret: process.env.SELLSY_CLIENT_SECRET
    };
    const response = await axios.post(SELLSY_OAUTH_URL, requestData, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    if (!response.data || !response.data.access_token) {
      throw new Error("Token non reçu dans la réponse de l'API Sellsy");
    }
    console.log("✅ Token d'accès Sellsy obtenu avec succès");
    accessToken = response.data.access_token;
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 300000; // 5 minutes de marge
    return accessToken;
  } catch (error) {
    console.error(`❌ Erreur lors de l'obtention du token Sellsy (tentative ${retryCount + 1}/${MAX_RETRIES}):`, error.message);
    if (error.response) {
      console.error('Détails de l\'erreur:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return getAccessToken(retryCount + 1);
    }
    throw new Error("Impossible d'obtenir un token d'accès Sellsy après plusieurs tentatives.");
  }
}

/**
 * Vérifie que les identifiants Sellsy sont configurés
 * @throws {Error} - Si les identifiants ne sont pas configurés
 */
function checkSellsyCredentials() {
  if (!process.env.SELLSY_CLIENT_ID || !process.env.SELLSY_CLIENT_SECRET) {
    throw new Error('Les identifiants Sellsy ne sont pas configurés.');
  }
}

/**
 * Effectue une requête à l'API Sellsy
 * @param {string} method - La méthode HTTP (get, post, etc.)
 * @param {string} endpoint - L'endpoint API (sans le préfixe d'URL)
 * @param {Object|null} data - Les données à envoyer (pour POST, PUT, etc.)
 * @param {number} retryCount - Le nombre de tentatives déjà effectuées
 * @returns {Promise<Object>} - La réponse de l'API
 */
async function sellsyRequest(method, endpoint, data = null, retryCount = 0) {
  checkSellsyCredentials();
  const MAX_RETRIES = 3;
  try {
    const token = await getAccessToken();
    const config = {
      method,
      url: `${SELLSY_API_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    if (data) config.data = data;
    
    console.log(`🔄 Requête ${method.toUpperCase()} à ${endpoint}...`);
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur API Sellsy (${method} ${endpoint}) - tentative ${retryCount + 1}/${MAX_RETRIES}:`, error.message);
    if (error.response) {
      console.error("Détails de l'erreur:", error.response.data);
      if (error.response.status === 400 && data) {
        console.error("Corps de la requête erronée:", JSON.stringify(data, null, 2));
      }
    }
    // Réessayer en cas d'erreur d'authentification
    if (error.response?.status === 401) {
      accessToken = null;
      tokenExpiration = null;
      if (retryCount < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return sellsyRequest(method, endpoint, data, retryCount + 1);
      }
    }
    // Réessayer pour les autres erreurs (sauf 400 Bad Request)
    if (retryCount < MAX_RETRIES - 1 && error.response?.status !== 400) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return sellsyRequest(method, endpoint, data, retryCount + 1);
    }
    throw error;
  }
}

/**
 * Recherche une méthode de paiement par son nom
 * @param {string} nameToFind - Le nom de la méthode de paiement à chercher
 * @returns {Promise<string>} - L'ID de la méthode de paiement
 */
export async function findPaymentMethodByName(nameToFind) {
  try {
    console.log(`🔍 Recherche de la méthode de paiement "${nameToFind}"...`);
    const response = await sellsyRequest('get', '/payments/methods');
    
    if (!response || !response.data) {
      throw new Error("Aucune méthode de paiement trouvée dans la réponse");
    }
    
    const method = response.data.find(m => 
      m.label && m.label.toLowerCase().includes(nameToFind.toLowerCase())
    );
    
    if (!method) {
      console.warn(`⚠️ Méthode de paiement "${nameToFind}" non trouvée. Méthodes disponibles:`, 
        response.data.map(m => m.label).join(', '));
      throw new Error(`Méthode de paiement "${nameToFind}" non trouvée.`);
    }
    
    console.log(`✅ Méthode de paiement trouvée: ${method.label} (ID: ${method.id})`);
    return method.id;
  } catch (error) {
    console.error("❌ Erreur lors de la recherche de méthode de paiement:", error);
    throw error;
  }
}

/**
 * Récupère les mandats GoCardless disponibles pour un client
 * @param {string|number} clientId - L'ID du client Sellsy
 * @returns {Promise<Array>} - Liste des mandats GoCardless
 */
export async function getClientGoCardlessMandates(clientId) {
  try {
    console.log(`🔍 Récupération des mandats GoCardless pour le client ID ${clientId}...`);
    
    // Utiliser l'API des mandats avec un filtre sur le client
    const filters = {
      related: [
        {
          id: parseInt(clientId),
          type: "individual"  // Ou "company" selon votre cas
        }
      ]
    };
    
    const response = await sellsyRequest('post', '/mandates/search', { filters });
    
    if (!response || !response.data) {
      console.warn(`⚠️ Aucun mandat trouvé pour le client ID ${clientId}`);
      return [];
    }
    
    console.log(`✅ ${response.data.length} mandat(s) GoCardless trouvé(s) pour le client ID ${clientId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération des mandats GoCardless pour le client ID ${clientId}:`, error.message);
    return [];
  }
}

/**
 * Recherche le mandat GoCardless actif par défaut pour un client
 * @param {string|number} clientId - L'ID du client Sellsy
 * @returns {Promise<Object|null>} - Le mandat GoCardless par défaut ou null si non trouvé
 */
export async function findDefaultGoCardlessMandate(clientId) {
  try {
    const mandates = await getClientGoCardlessMandates(clientId);
    
    if (!mandates.length) {
      return null;
    }
    
    // Rechercher d'abord un mandat par défaut actif
    let mandate = mandates.find(m => 
      m.is_default === true && 
      m.status && 
      m.status.toLowerCase() === 'active'
    );
    
    // Si aucun mandat par défaut, prendre le premier mandat actif
    if (!mandate) {
      mandate = mandates.find(m => 
        m.status && 
        m.status.toLowerCase() === 'active'
      );
    }
    
    if (!mandate) {
      console.warn(`⚠️ Aucun mandat GoCardless actif trouvé pour le client ID ${clientId}`);
      return null;
    }
    
    console.log(`✅ Mandat GoCardless actif trouvé: ID=${mandate.id}, Référence=${mandate.reference || 'Non définie'}`);
    return mandate;
  } catch (error) {
    console.error(`❌ Erreur lors de la recherche du mandat GoCardless pour le client ID ${clientId}:`, error.message);
    return null;
  }
}

/**
 * Recherche les modes de paiement disponibles pour une facture
 * @param {string|number} invoiceId - L'ID de la facture
 * @returns {Promise<Array>} - Liste des modes de paiement disponibles
 */
export async function getInvoicePaymentModes(invoiceId) {
  try {
    console.log(`🔍 Récupération des modes de paiement disponibles pour la facture ${invoiceId}...`);
    const response = await sellsyRequest('get', `/invoices/${invoiceId}/payment-modes`);
    
    if (!response || !response.data) {
      throw new Error("Aucun mode de paiement disponible pour cette facture");
    }
    
    console.log(`✅ ${response.data.length} modes de paiement disponibles pour la facture ${invoiceId}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération des modes de paiement pour la facture ${invoiceId}:`, error.message);
    return [];
  }
}

/**
 * Trouve le mode de paiement GoCardless pour une facture
 * @param {string|number} invoiceId - L'ID de la facture
 * @returns {Promise<Object|null>} - Le mode de paiement GoCardless ou null si non trouvé
 */
export async function findGoCardlessPaymentMode(invoiceId) {
  try {
    const paymentModes = await getInvoicePaymentModes(invoiceId);
    
    // Recherche du mode de paiement GoCardless
    const goCardlessMode = paymentModes.find(mode => 
      (mode.gateway && mode.gateway.toLowerCase() === 'gocardless') ||
      (mode.name && mode.name.toLowerCase().includes('gocardless')) ||
      (mode.type && mode.type.toLowerCase() === 'directdebit')
    );
    
    if (!goCardlessMode) {
      console.warn('⚠️ Mode de paiement GoCardless non trouvé. Modes disponibles:', 
        paymentModes.map(m => `${m.name || m.type || 'Non défini'}`).join(', '));
      return null;
    }
    
    console.log(`✅ Mode de paiement GoCardless trouvé: ${goCardlessMode.name || goCardlessMode.type} (ID: ${goCardlessMode.id})`);
    return goCardlessMode;
  } catch (error) {
    console.error(`❌ Erreur lors de la recherche du mode GoCardless:`, error.message);
    return null;
  }
}

/**
 * Récupère les détails d'un service depuis Sellsy
 * @param {string|number} serviceId - L'ID du service à récupérer
 * @returns {Promise<Object>} - Les détails du service
 */
export async function getServiceDetails(serviceId) {
  try {
    console.log(`🔍 Récupération des détails du service ID ${serviceId}...`);
    const response = await sellsyRequest('get', `/services/${serviceId}`);
    
    if (!response) {
      throw new Error(`Aucune information trouvée pour le service ID ${serviceId}`);
    }
    
    console.log(`✅ Détails du service ID ${serviceId} récupérés`);
    return response;
  } catch (error) {
    console.error(`❌ Erreur lors de la récupération des détails du service ${serviceId}:`, error.message);
    throw error;
  }
}

/**
 * Vérifie si un client a un mandat GoCardless actif et initie un prélèvement
 * @param {string|number} invoiceId - L'ID de la facture
 * @param {string|number} clientId - L'ID du client
 * @returns {Promise<Object>} - Résultat du traitement
 */
export async function processInvoiceWithGoCardless(invoiceId, clientId) {
  try {
    console.log(`🔄 Traitement de la facture ${invoiceId} avec GoCardless pour le client ${clientId}...`);
    
    // 1. Vérifier si le client a un mandat GoCardless actif
    const mandate = await findDefaultGoCardlessMandate(clientId);
    
    if (!mandate) {
      throw new Error(`Aucun mandat GoCardless actif trouvé pour le client ID ${clientId}`);
    }
    
    // 2. Récupérer les modes de paiement disponibles pour cette facture
    const goCardlessMode = await findGoCardlessPaymentMode(invoiceId);
    
    if (!goCardlessMode) {
      throw new Error('Mode de paiement GoCardless non disponible pour cette facture');
    }
    
    // 3. Préparer le paiement
    const paymentData = {
      amount: "full",  // Payer le montant total de la facture
      mode_id: goCardlessMode.id,
      mandate_id: mandate.id  // Ajouter l'ID du mandat GoCardless
    };
    
    // Si l'API exige un type spécifique, nous l'ajoutons
    if (goCardlessMode.type) {
      paymentData.type = goCardlessMode.type;
    }
    
    console.log(`💰 Préparation du paiement avec GoCardless (Mode ID: ${goCardlessMode.id}, Mandat ID: ${mandate.id})...`);
    console.log(`Données de paiement:`, JSON.stringify(paymentData, null, 2));
    
    // 4. Créer le paiement
    const payment = await sellsyRequest('post', `/invoices/${invoiceId}/payments`, paymentData);
    
    console.log(`✅ Paiement initié avec succès pour la facture ${invoiceId}`);
    console.log(`📊 Détails du paiement: ID=${payment.id}, Statut=${payment.status || 'Non défini'}`);
    
    return payment;
  } catch (error) {
    console.error(`❌ Erreur lors du traitement de la facture ${invoiceId} avec GoCardless:`, error.message);
    if (error.response) {
      console.error("Détails de l'erreur:", error.response.data);
    }
    throw error;
  }
}

/**
 * Génère une facture dans Sellsy
 * @param {Object} options - Les options pour la création de facture
 * @param {string|number} options.clientId - L'ID client Sellsy
 * @param {string|number} options.serviceId - L'ID service Sellsy
 * @param {string} options.serviceName - Le nom du service
 * @param {number|string} options.price - Le prix HT
 * @param {number|string} options.taxRate - Le taux de TVA (par défaut 20)
 * @param {string} options.paymentMethod - La méthode de paiement (par défaut 'prélèvement')
 * @returns {Promise<Object>} - La facture créée
 */
export async function generateInvoice({ clientId, serviceId, serviceName, price, taxRate = 20, paymentMethod = 'prélèvement' }) {
  try {
    console.log(`🔄 Génération d'une facture pour le client ID ${clientId}, service: ${serviceName}`);
    
    if (!clientId || !serviceName || !price) {
      throw new Error(`Paramètres manquants: clientId=${clientId}, serviceName=${serviceName}, price=${price}`);
    }
    
    // Recherche de l'ID de la méthode de paiement
    let paymentMethodId;
    try {
      paymentMethodId = await findPaymentMethodByName(paymentMethod);
    } catch (error) {
      console.warn(`⚠️ Méthode de paiement non trouvée, la facture sera créée sans méthode de paiement spécifiée`);
    }
    
    // Préparation des dates
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    
    // Conversion des valeurs numériques
    const numericPrice = parseFloat(price);
    const numericTaxRate = parseFloat(taxRate);
    const numericClientId = parseInt(clientId);
    const numericServiceId = parseInt(serviceId);
    
    console.log(`📊 Prix: ${numericPrice}, Taux TVA: ${numericTaxRate}%, Client ID: ${numericClientId}`);
    
    // Création de l'objet facture selon la documentation de l'API Sellsy V2
    const invoiceData = {
      date: formattedDate,
      due_date: formattedDate,
      subject: `Abonnement mensuel - ${serviceName}`,
      currency: "EUR",
      
      related: [
        {
          id: numericClientId,
          type: "individual"
        }
      ],
      
      note: "Facture prélevée automatiquement par prélèvement SEPA à réception. Aucune action requise de votre part.",
      
      // Ajout de la méthode de paiement si disponible
      ...(paymentMethodId ? { payment_method_ids: [paymentMethodId] } : {}),
      
      rows: [
        {
          // Utiliser "catalog" comme type selon la documentation Sellsy V2
          type: "catalog",
          related: {
            id: numericServiceId,
            type: "service"
          },
          unit_amount: numericPrice.toString(), // Convertir en string comme demandé dans la doc
          tax_rate: numericTaxRate.toString(), // Convertir en string
          quantity: "1", // En string d'après la doc
          // Ne pas spécifier la description, Sellsy utilisera la description du service du catalogue
        }
      ]
    };
    
    console.log("📄 Données facture :", JSON.stringify(invoiceData, null, 2));
    
    // Création de la facture
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    console.log(`✅ Facture créée avec ID: ${invoice.id}`);
    
    // Validation de la facture (obligatoire avant de pouvoir la payer)
    try {
      await sellsyRequest('post', `/invoices/${invoice.id}/validate`, { date: formattedDate });
      console.log(`✅ Facture ${invoice.id} validée avec succès`);
      
      // Traitement du paiement avec GoCardless après validation
      try {
        await processInvoiceWithGoCardless(invoice.id, numericClientId);
        console.log(`💶 Prélèvement GoCardless initié pour la facture ${invoice.id}`);
      } catch (paymentError) {
        console.warn(`⚠️ Impossible d'initier le prélèvement GoCardless: ${paymentError.message}`);
        console.log(`⚠️ La facture a été créée et validée mais le prélèvement devra être déclenché manuellement.`);
      }
      
    } catch (validationError) {
      console.warn(`⚠️ Impossible de valider la facture: ${validationError.message}`);
      console.log(`⚠️ La facture a été créée mais n'a pas pu être validée automatiquement.`);
    }
    
    return invoice;
  } catch (error) {
    console.error("❌ Erreur lors de la génération de la facture:", error);
    throw error;
  }
}

/**
 * Vérifie la connexion à l'API Sellsy
 * @returns {Promise<boolean>} - Vrai si la connexion est établie avec succès
 */
export async function checkSellsyConnection() {
  try {
    console.log('🔄 Vérification connexion API Sellsy...');
    checkSellsyCredentials();
    const token = await getAccessToken();
    if (!token) return false;
    
    // Au lieu de /account/info qui n'existe pas, utiliser un endpoint existant
    // /companies pour récupérer la liste des entreprises (limité à 1 résultat pour éviter une charge inutile)
    const response = await sellsyRequest('get', '/companies?limit=1');
    
    if (response) {
      console.log('✅ Connexion API Sellsy OK');
      if (response.data && response.data.length > 0) {
        console.log(`🏢 Premier client trouvé: ${response.data[0].name || 'Non défini'}`);
      } else {
        console.log(`🏢 Connecté à l'API Sellsy (aucun client trouvé)`);
      }
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Échec de connexion à l\'API Sellsy:', error);
    return false;
  }
}
