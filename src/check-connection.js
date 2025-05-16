// Script pour tester la connexion à l'API Sellsy
import dotenv from 'dotenv';
import { checkSellsyConnection } from './sellsy.js';

// Chargement des variables d'environnement
dotenv.config();

/**
 * Fonction principale pour tester la connexion à l'API Sellsy
 */
async function main() {
  console.log('🔄 Test de connexion à l\'API Sellsy...');

  try {
    // Vérifier que les variables d'environnement nécessaires sont définies
    if (!process.env.SELLSY_CLIENT_ID || !process.env.SELLSY_CLIENT_SECRET) {
      console.error('❌ Variables d\'environnement SELLSY_CLIENT_ID et/ou SELLSY_CLIENT_SECRET non définies');
      console.error('💡 Assurez-vous d\'avoir créé un fichier .env avec ces variables ou de les avoir configurées dans GitHub Actions');
      process.exit(1);
    }
    
    // Tester la connexion
    const isConnected = await checkSellsyConnection();
    
    if (isConnected) {
      console.log('✅ Connexion à l\'API Sellsy réussie! Vos identifiants sont valides.');
      process.exit(0);
    } else {
      console.error('❌ Échec de la connexion à l\'API Sellsy. Vérifiez vos identifiants.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erreur lors du test de connexion:');
    console.error(error);
    
    // Conseils de débogage
    console.log('\n💡 Conseils de dépannage:');
    console.log('1. Vérifiez que vos identifiants SELLSY_CLIENT_ID et SELLSY_CLIENT_SECRET sont corrects');
    console.log('2. Assurez-vous que votre compte Sellsy dispose des autorisations API nécessaires');
    console.log('3. Vérifiez votre connexion Internet');
    console.log('4. L\'API Sellsy pourrait être temporairement indisponible, réessayez plus tard');
    
    process.exit(1);
  }
}

// Exécution du script
main();
