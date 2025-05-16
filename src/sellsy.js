// Module d'intégration avec l'API Sellsy V2
import axios from 'axios';

// URL de base pour l'API Sellsy V2
const SELLSY_API_URL = 'https://api.sellsy.com/v2';
const SELLSY_OAUTH_URL = 'https://login.sellsy.com/oauth2/access-tokens';

// Stockage du token d'accès
let accessToken = null;
let tokenExpiration = null;

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
      await new Promise(resolve => setTimeout(resolve, 3000));
      return getAccessToken(retryCount + 1);
    }
    throw new Error("Impossible d'obtenir un token d'accès Sellsy après plusieurs tentatives.");
  }
}

function checkSellsyCredentials() {
  if (!process.env.SELLSY_CLIENT_ID || !process.env.SELLSY_CLIENT_SECRET) {
    throw new Error('Les identifiants Sellsy ne sont pas configurés.');
  }
}

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
    if (error.response?.status === 401) {
      accessToken = null;
      tokenExpiration = null;
      if (retryCount < MAX_RETRIES - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return sellsyRequest(method, endpoint, data, retryCount + 1);
      }
    }
    if (retryCount < MAX_RETRIES - 1 && error.code !== 'ERR_BAD_REQUEST') {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return sellsyRequest(method, endpoint, data, retryCount + 1);
    }
    throw error;
  }
}

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

export async function generateInvoice({ clientId, serviceId, serviceName, price, taxRate = 20, paymentMethod = 'gocardless' }) {
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
    
    console.log(`📊 Prix: ${numericPrice}, Taux TVA: ${numericTaxRate}%, Client ID: ${numericClientId}`);
    
    // Création de l'objet facture selon la documentation de l'API Sellsy V2
    const invoiceData = {
      date: formattedDate,
      due_date: formattedDate,
      subject: `Abonnement mensuel - ${serviceName}`,
      currency: 'EUR',
      
      // Format correct pour l'objet "related" selon la documentation
      related: [
        {
          id: numericClientId,
          type: "client"  // "client" et non "clients"
        }
      ],
      
      // Ajout de la méthode de paiement si disponible
      ...(paymentMethodId ? { payment_method_ids: [paymentMethodId] } : {}),
      
      note: "Facture prélevée automatiquement par prélèvement SEPA à réception. Aucune action requise de votre part.",
      
      // Format correct pour les lignes selon la documentation
      rows: [
        {
          type: "service",
          name: serviceName,
          qty: 1,
          unit_price: numericPrice,
          tax_rate: numericTaxRate,
          unit: "unité"
        }
      ]
    };
    
    console.log("📄 Données facture :", JSON.stringify(invoiceData, null, 2));
    
    // Création de la facture
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    console.log(`✅ Facture créée avec ID: ${invoice.id}`);
    
    // Validation de la facture (si nécessaire)
    try {
      await sellsyRequest('post', `/invoices/${invoice.id}/validate`, { date: formattedDate });
      console.log(`✅ Facture ${invoice.id} validée avec succès`);
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

export async function checkSellsyConnection() {
  try {
    console.log('🔄 Vérification connexion API Sellsy...');
    checkSellsyCredentials();
    const token = await getAccessToken();
    if (!token) return false;
    
    // Test d'une requête simple pour vérifier la connexion
    // Utiliser un endpoint disponible dans l'API V2
    const response = await sellsyRequest('get', '/account/info');
    
    if (response) {
      console.log('✅ Connexion API Sellsy OK');
      console.log(`🏢 Connecté au compte: ${response.name || 'Non défini'}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ Échec de connexion à l\'API Sellsy:', error);
    return false;
  }
}
