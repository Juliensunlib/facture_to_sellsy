// Module d'intégration avec l'API Sellsy V2
import axios from 'axios';

// URL de base pour l'API Sellsy V2
const SELLSY_API_URL = 'https://api.sellsy.com/v2';
const SELLSY_OAUTH_URL = 'https://login.sellsy.com/oauth2/access-tokens';

// Stockage du token d'accès
let accessToken = null;
let tokenExpiration = null;

/**
 * Obtient un token d'accès OAuth2 pour l'API Sellsy
 * Utilise le flux 'client_credentials' pour l'authentification
 */
async function getAccessToken(retryCount = 0) {
  // Si le token est valide et n'a pas expiré, le retourner
  if (accessToken && tokenExpiration && tokenExpiration > Date.now()) {
    return accessToken;
  }

  // Maximum de 3 tentatives
  const MAX_RETRIES = 3;
  
  try {
    console.log('🔄 Obtention d\'un nouveau token d\'accès Sellsy...');
    
    // Préparation des données pour la requête
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

    // Vérification de la réponse
    if (!response.data || !response.data.access_token) {
      throw new Error('Token non reçu dans la réponse de l\'API Sellsy');
    }

    console.log('✅ Token d\'accès Sellsy obtenu avec succès');
    accessToken = response.data.access_token;
    // Convertir la durée d'expiration en millisecondes et soustraire 5 minutes pour la marge
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 300000;

    return accessToken;
  } catch (error) {
    // Afficher des informations détaillées sur l'erreur
    console.error(`❌ Erreur lors de l'obtention du token Sellsy (tentative ${retryCount + 1}/${MAX_RETRIES}):`, error.message);
    
    if (error.response) {
      console.error('Détails de l\'erreur:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    // Vérifier si nous pouvons réessayer
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`🔄 Nouvelle tentative d'obtention du token dans 3 secondes...`);
      // Attendre 3 secondes avant de réessayer
      await new Promise(resolve => setTimeout(resolve, 3000));
      return getAccessToken(retryCount + 1);
    }
    
    throw new Error(`Impossible d'obtenir un token d'accès Sellsy après ${MAX_RETRIES} tentatives. Vérifiez vos identifiants API.`);
  }
}

/**
 * Vérifie si les identifiants Sellsy sont correctement configurés
 */
function checkSellsyCredentials() {
  if (!process.env.SELLSY_CLIENT_ID || !process.env.SELLSY_CLIENT_SECRET) {
    throw new Error('Les identifiants Sellsy (SELLSY_CLIENT_ID et SELLSY_CLIENT_SECRET) ne sont pas configurés dans les variables d\'environnement');
  }
}

/**
 * Fonction pour effectuer des requêtes à l'API Sellsy avec retry automatique
 */
async function sellsyRequest(method, endpoint, data = null, retryCount = 0) {
  // Vérifier les identifiants avant d'essayer
  checkSellsyCredentials();
  
  // Maximum de 3 tentatives
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
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`❌ Erreur API Sellsy (${method} ${endpoint}) - tentative ${retryCount + 1}/${MAX_RETRIES}:`, error.message);
    
    if (error.response) {
      console.error('Détails de l\'erreur:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    // Si erreur d'authentification (401), essayer de renouveler le token
    if (error.response?.status === 401) {
      console.log('🔄 Token expiré ou révoqué, renouvellement du token...');
      // Forcer le renouvellement du token
      accessToken = null;
      tokenExpiration = null;
      
      // Si ce n'est pas la dernière tentative, réessayer
      if (retryCount < MAX_RETRIES - 1) {
        console.log(`🔄 Nouvelle tentative de la requête dans 2 secondes...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return sellsyRequest(method, endpoint, data, retryCount + 1);
      }
    }
    
    // Si ce n'est pas une erreur d'authentification mais qu'on peut réessayer
    if (retryCount < MAX_RETRIES - 1 && error.code !== 'ERR_BAD_REQUEST') {
      console.log(`🔄 Nouvelle tentative de la requête dans 2 secondes...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return sellsyRequest(method, endpoint, data, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Recherche une méthode de paiement par son nom
 */
async function findPaymentMethodByName(name) {
  try {
    console.log(`🔍 Recherche de la méthode de paiement "${name}"...`);
    
    const response = await sellsyRequest('post', '/payments/methods/search', {
      filters: {
        is_active: true
      }
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      throw new Error(`Format de réponse inattendu lors de la recherche des méthodes de paiement`);
    }
    
    console.log(`✅ ${response.data.length} méthodes de paiement trouvées`);
    
    // Recherche par nom (insensible à la casse)
    const paymentMethod = response.data.find(method => 
      method.label.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!paymentMethod) {
      // Liste des méthodes disponibles pour le débogage
      const availableMethods = response.data.map(m => m.label).join(', ');
      console.warn(`⚠️ Méthode de paiement "${name}" non trouvée. Méthodes disponibles: ${availableMethods}`);
      
      // Si on ne trouve pas GoCardless, essayer de prendre la première méthode active
      if (response.data.length > 0) {
        console.log(`ℹ️ Utilisation de la méthode de paiement par défaut: ${response.data[0].label}`);
        return response.data[0].id;
      }
      
      throw new Error(`Méthode de paiement "${name}" non trouvée dans Sellsy`);
    }
    
    console.log(`✅ Méthode de paiement "${paymentMethod.label}" (ID: ${paymentMethod.id}) trouvée`);
    return paymentMethod.id;
  } catch (error) {
    console.error('❌ Erreur lors de la recherche de la méthode de paiement:', error);
    throw error;
  }
}

/**
 * Configure les options de prélèvement GoCardless sur une facture
 */
async function configureGoCardlessPayment(invoiceId) {
  try {
    console.log(`🔄 Configuration du paiement GoCardless pour la facture ${invoiceId}...`);
    
    // Trouver l'ID de la méthode GoCardless
    const paymentMethodId = await findPaymentMethodByName('gocardless');
    
    // Configurer le paiement par prélèvement GoCardless
    await sellsyRequest('post', `/invoices/${invoiceId}/payment-details`, {
      payment_method_id: paymentMethodId,
      payment_terms: "on_receipt", // Paiement à réception
      use_direct_debit: true       // Utiliser le prélèvement automatique
    });
    
    console.log(`✅ Configuration du paiement GoCardless réussie pour la facture ${invoiceId}`);
    return true;
  } catch (error) {
    console.error(`❌ Erreur lors de la configuration du prélèvement GoCardless:`, error);
    throw error;
  }
}

/**
 * Génère une facture dans Sellsy
 */
export async function generateInvoice({
  clientId,
  serviceId,
  serviceName,
  price,
  taxRate = 20,
  paymentMethod = 'gocardless'
}) {
  try {
    console.log(`🔄 Génération d'une facture pour ${serviceName} (client ID: ${clientId})...`);
    
    // Vérification des paramètres
    if (!clientId || !serviceName || !price) {
      throw new Error(`Paramètres manquants pour la génération de facture: clientId=${clientId}, serviceName=${serviceName}, price=${price}`);
    }
    
    // 1. Trouver l'ID de la méthode de paiement GoCardless
    const paymentMethodId = await findPaymentMethodByName(paymentMethod);
    
    // 2. Préparer les données de la facture
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
    
    // S'assurer que le prix est un nombre
    const numericPrice = parseFloat(price);
    if (isNaN(numericPrice)) {
      throw new Error(`Le prix '${price}' n'est pas un nombre valide`);
    }
    
    // S'assurer que le taux de TVA est un nombre
    const numericTaxRate = parseFloat(taxRate);
    if (isNaN(numericTaxRate)) {
      throw new Error(`Le taux de TVA '${taxRate}' n'est pas un nombre valide`);
    }
    
    // S'assurer que l'ID client est un nombre
    const numericClientId = parseInt(clientId);
    if (isNaN(numericClientId)) {
      throw new Error(`L'ID client '${clientId}' n'est pas un nombre valide`);
    }
    
    const invoiceData = {
      date: formattedDate,
      due_date: formattedDate, // Même date = paiement à réception
      subject: `Abonnement mensuel - ${serviceName}`,
      related: [
        {
          id: numericClientId,
          type: "company"
        }
      ],
      payment_method_ids: [paymentMethodId],
      rows: [
        {
          type: "item",
          name: serviceName,
          qty: 1,
          unit_price: numericPrice,
          tax_rate: numericTaxRate
        }
      ],
      note: "Facture prélevée automatiquement par GoCardless à réception. Aucune action requise de votre part."
    };
    
    console.log(`📄 Données de la facture préparées: ${JSON.stringify(invoiceData, null, 2)}`);
    
    // 3. Créer la facture
    console.log(`🔄 Création de la facture dans Sellsy...`);
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    console.log(`✅ Facture créée avec l'ID: ${invoice.id}`);
    
    // 4. Configurer le prélèvement GoCardless
    await configureGoCardlessPayment(invoice.id);
    
    // 5. Valider la facture (passer de brouillon à émise)
    console.log(`🔄 Validation de la facture ${invoice.id}...`);
    await sellsyRequest('post', `/invoices/${invoice.id}/validate`, {
      date: formattedDate
    });
    console.log(`✅ Facture ${invoice.id} validée avec succès`);
    
    return invoice;
  } catch (error) {
    console.error('❌ Erreur lors de la génération de la facture:', error);
    throw error;
  }
}

/**
 * Vérifie la connexion avec l'API Sellsy
 */
export async function checkSellsyConnection() {
  try {
    console.log('🔄 Vérification de la connexion à l\'API Sellsy...');
    
    // Vérifier les identifiants
    checkSellsyCredentials();
    
    // Tenter d'obtenir un token d'accès
    const token = await getAccessToken();
    
    if (!token) {
      console.error('❌ Impossible d\'obtenir un token d\'accès Sellsy');
      return false;
    }
    
    // Tester l'accès à un endpoint simple (teams)
    const response = await sellsyRequest('get', '/teams');
    
    if (response && response.data) {
      console.log('✅ Connexion à l\'API Sellsy établie avec succès');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Échec de la connexion à l\'API Sellsy:', error);
    return false;
  }
}
