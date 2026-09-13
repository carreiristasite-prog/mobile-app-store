export const EXTERNAL_LINKS = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL || 'https://iaaprova.com.br/terms/',
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL || 'https://iaaprova.com.br/privacy/',
  help: process.env.EXPO_PUBLIC_HELP_URL || 'https://iaaprova.com.br/support/',
  accountDeletion: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || 'https://iaaprova.com.br/account-deletion/',
} as const;
