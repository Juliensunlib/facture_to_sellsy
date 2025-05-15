// Module d'intégration avec l'API Sellsy V2
import axios from 'axios';

// URL de base pour l'API Sellsy V2
const SELLSY_API_URL = 'https://api.sellsy.com/v2';

// Stockage du token d'accès
let accessToken = null;
let tokenExpiration = null;

/**
 * Obtient un token d'accès OAuth2 pour l'API Sellsy
 */
async function getAccessToken() {
  // Si le token est valide et n'a pas expiré, le retourner
  if (accessToken && tokenExpiration && tokenExpiration > Date.now()) {
    return accessToken;
  }

  try {
    const response = await axios.post('https://api.sellsy.com/oauth2/token', {
      grant_type: 'client_credentials',
      client_id: process.env.SELLSY_CLIENT_ID,
      client_secret: process.env.SELLSY_CLIENT_SECRET
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    accessToken = response.data.access_token;
    // Convertir la durée d'expiration en millisecondes et soustraire 5 minutes pour la marge
    tokenExpiration = Date.now() + (response.data.expires_in * 1000) - 300000;

    return accessToken;
  } catch (error) {
    console.error('❌ Erreur lors de l\'obtention du token Sellsy:', error.response?.data || error.message);
    throw new Error('Impossible d\'obtenir un token d\'accès Sellsy');
  }
}

/**
 * Fonction pour effectuer des requêtes à l'API Sellsy
 */
async function sellsyRequest(method, endpoint, data = null) {
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
    console.error(`❌ Erreur API Sellsy (${method} ${endpoint}):`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Recherche une méthode de paiement par son nom
 */
async function findPaymentMethodByName(name) {
  try {
    const response = await sellsyRequest('post', '/payments/methods/search', {
      filters: {
        is_active: true
      }
    });
    
    const paymentMethod = response.data.find(method => 
      method.label.toLowerCase().includes(name.toLowerCase())
    );
    
    return paymentMethod ? paymentMethod.id : null;
  } catch (error) {
    console.error('❌ Erreur lors de la recherche de la méthode de paiement:', error);
    return null;
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
    // 1. Trouver l'ID de la méthode de paiement GoCardless
    const paymentMethodId = await findPaymentMethodByName(paymentMethod);
    
    if (!paymentMethodId) {
      throw new Error(`Méthode de paiement "${paymentMethod}" non trouvée`);
    }
    
    // 2. Préparer les données de la facture
    const today = new Date();
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() + 1); // Paiement à réception (J+1)
    
    const invoiceData = {
      date: today.toISOString().split('T')[0],
      due_date: dueDate.toISOString().split('T')[0],
      subject: `Abonnement mensuel - ${serviceName}`,
      related: [
        {
          id: parseInt(clientId),
          type: "company"
        }
      ],
      payment_method_ids: [paymentMethodId],
      rows: [
        {
          type: "item",
          name: serviceName,
          qty: 1,
          unit_price: parseFloat(price),
          tax_rate: parseFloat(taxRate)
        }
      ]
    };
    
    // 3. Créer la facture
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    
    // 4. Valider la facture (passer de brouillon à émise)
    await sellsyRequest('post', `/invoices/${invoice.id}/validate`, {
      date: today.toISOString().split('T')[0]
    });
    
    return invoice;
  } catch (error) {
    console.error('❌ Erreur lors de la génération de la facture:', error);
    throw error;
  }
}
