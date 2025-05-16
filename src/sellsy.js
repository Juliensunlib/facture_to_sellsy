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
 * @returns {Promise<string>} - Le token d'accès
 */
async function getAccessToken(retryCount = 0) {
  // Réutiliser le token si encore valide
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
    // Ajouter une marge de sécurité de 5 minutes
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 300000;
    
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
      // Attendre avant de réessayer
      await new Promise(resolve => setTimeout(resolve, 3000));
      return getAccessToken(retryCount + 1);
    }
    
    throw new Error("Impossible d'obtenir un token d'accès Sellsy après plusieurs tentatives.");
  }
}

/**
 * Effectue une requête à l'API Sellsy
 * @param {string} method - La méthode HTTP (get, post, etc.)
 * @param {string} endpoint - L'endpoint API (sans le préfixe d'URL)
 * @param {Object|null} data - Les données à envoyer (pour POST, PUT, etc.)
 * @returns {Promise<Object>} - La réponse de l'API
 */
async function sellsyRequest(method, endpoint, data = null, retryCount = 0) {
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
 * Génère une facture dans Sellsy (version simplifiée utilisant les références du catalogue)
 * @param {Object} options - Les options pour la création de facture
 * @param {string|number} options.clientId - L'ID client Sellsy
 * @param {string|number} options.serviceId - L'ID service Sellsy
 * @returns {Promise<Object>} - La facture créée
 */
export async function generateInvoice({ clientId, serviceId }) {
  try {
    console.log(`🔄 Génération d'une facture pour le client ID ${clientId}, service ID: ${serviceId}`);
    
    if (!clientId || !serviceId) {
      throw new Error(`Paramètres manquants: clientId=${clientId}, serviceId=${serviceId}`);
    }
    
    // Préparation des dates
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    
    // Conversion des valeurs en nombres
    const numericClientId = parseInt(clientId);
    const numericServiceId = parseInt(serviceId);
    
    // Recherche de l'ID de la méthode de paiement
    let paymentMethodId;
    try {
      paymentMethodId = await findPaymentMethodByName('prélèvement');
    } catch (error) {
      console.warn(`⚠️ Méthode de paiement non trouvée, la facture sera créée sans méthode de paiement spécifiée`);
    }
    
    // Création de l'objet facture avec le minimum d'informations
    // Sellsy complétera automatiquement les détails du service depuis son catalogue
    const invoiceData = {
      date: formattedDate,
      due_date: formattedDate,
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
          type: "catalog",
          related: {
            id: numericServiceId,
            type: "service"
          },
          quantity: "1" // En string d'après la doc API Sellsy
        }
      ]
    };
    
    console.log("📄 Données facture simplifiées:", JSON.stringify(invoiceData, null, 2));
    
    // Création de la facture
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    console.log(`✅ Facture créée avec ID: ${invoice.id}`);
    
    // Validation de la facture
    try {
      await sellsyRequest('post', `/invoices/${invoice.id}/validate`, { date: formattedDate });
      console.log(`✅ Facture ${invoice.id} validée avec succès`);
    } catch (validationError) {
      console.warn(`⚠️ Impossible de valider la facture: ${validationError.message}`);
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
    
    if (!process.env.SELLSY_CLIENT_ID || !process.env.SELLSY_CLIENT_SECRET) {
      throw new Error('Les identifiants Sellsy ne sont pas configurés.');
    }
    
    const token = await getAccessToken();
    if (!token) return false;
    
    // Test simple de l'API en récupérant une liste minimale de clients
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
