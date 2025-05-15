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
    
    if (!paymentMethod) {
      throw new Error(`Méthode de paiement "${name}" non trouvée dans Sellsy`);
    }
    
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
    // Configurer le paiement par prélèvement GoCardless
    await sellsyRequest('post', `/invoices/${invoiceId}/payment-details`, {
      payment_method_id: await findPaymentMethodByName('gocardless'),
      payment_terms: "on_receipt", // Paiement à réception
      use_direct_debit: true       // Utiliser le prélèvement automatique
    });
    
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
    // 1. Trouver l'ID de la méthode de paiement GoCardless
    const paymentMethodId = await findPaymentMethodByName(paymentMethod);
    
    // 2. Préparer les données de la facture
    const today = new Date();
    const dueDate = new Date(today); // Date d'échéance = aujourd'hui (paiement à réception)
    
    const invoiceData = {
      date: today.toISOString().split('T')[0],
      due_date: today.toISOString().split('T')[0], // Même date = paiement à réception
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
      ],
      note: "Facture prélevée automatiquement par GoCardless à réception. Aucune action requise de votre part."
    };
    
    // 3. Créer la facture
    const invoice = await sellsyRequest('post', '/invoices', invoiceData);
    
    // 4. Configurer le prélèvement GoCardless
    await configureGoCardlessPayment(invoice.id);
    
    // 5. Valider la facture (passer de brouillon à émise)
    await sellsyRequest('post', `/invoices/${invoice.id}/validate`, {
      date: today.toISOString().split('T')[0]
    });
    
    return invoice;
  } catch (error) {
    console.error('❌ Erreur lors de la génération de la facture:', error);
    throw error;
  }
}
