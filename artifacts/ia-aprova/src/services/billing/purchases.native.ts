import Constants from 'expo-constants';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';
import { PurchaseCancelledError, type MonthlyOffering } from './purchases.types';

const MONTHLY_PRODUCT_ID = Platform.select({
  ios: 'iaaprova.pro.monthly' as const,
  android: 'iaaprova.pro.monthly:monthly-auto-renewing' as const,
}) ?? 'iaaprova.pro.monthly';

let configured = false;
let monthlyPackage: PurchasesPackage | null = null;
let monthlyPackageOwnerId: string | null = null;
let operationQueue: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function platformApiKey(): string | null {
  const value = Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  })?.trim();
  if (!value || value.includes('replace_in_eas')) return null;
  return value;
}

function configureIfNeeded(): boolean {
  const apiKey = platformApiKey();
  // RevenueCat's Expo Go preview mode uses mocks. Release behavior must be
  // tested only in a native development/preview/production build.
  if (!apiKey || Constants.appOwnership === 'expo') return false;
  if (!configured) {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    Purchases.configure({ apiKey });
    configured = true;
  }
  return true;
}

export function resetPurchasesCache(): void {
  monthlyPackage = null;
  monthlyPackageOwnerId = null;
}

async function syncPurchasesIdentityUnsafe(userId: string | null): Promise<boolean> {
  if (!configureIfNeeded()) return false;

  const currentUserId = await Purchases.getAppUserID();
  if (userId && currentUserId !== userId) {
    await Purchases.logIn(userId);
    monthlyPackage = null;
    monthlyPackageOwnerId = null;
  } else if (!userId && !currentUserId.startsWith('$RCAnonymousID:')) {
    await Purchases.logOut();
    monthlyPackage = null;
    monthlyPackageOwnerId = null;
  }
  return Boolean(userId);
}

export function syncPurchasesIdentity(userId: string | null): Promise<boolean> {
  return serialize(() => syncPurchasesIdentityUnsafe(userId));
}

async function requireExpectedIdentity(userId: string): Promise<void> {
  if (!configureIfNeeded()) throw new Error('As compras não estão configuradas neste build.');
  if (await Purchases.getAppUserID() !== userId) {
    throw new Error('A conta da loja mudou. Tente novamente.');
  }
}

async function findMonthlyPackage(userId: string): Promise<PurchasesPackage | null> {
  if (!configureIfNeeded()) return null;
  await requireExpectedIdentity(userId);
  const offerings = await Purchases.getOfferings();
  monthlyPackage = offerings.current?.availablePackages.find(
    (candidate) => candidate.product.identifier === MONTHLY_PRODUCT_ID,
  ) ?? null;
  monthlyPackageOwnerId = monthlyPackage ? userId : null;
  return monthlyPackage;
}

export function getMonthlyOffering(userId: string): Promise<MonthlyOffering | null> {
  return serialize(async () => {
    const candidate = await findMonthlyPackage(userId);
    if (!candidate) return null;
    return {
      productId: MONTHLY_PRODUCT_ID,
      localizedPrice: candidate.product.priceString,
      available: true,
    };
  });
}

export function purchaseMonthly(userId: string): Promise<void> {
  return serialize(async () => {
    await requireExpectedIdentity(userId);
    const candidate = monthlyPackageOwnerId === userId ? monthlyPackage : await findMonthlyPackage(userId);
    if (!candidate) {
      throw new Error('O plano mensal não está disponível nesta loja.');
    }
    try {
      await Purchases.purchasePackage(candidate);
    } catch (error) {
      const purchaseError = error as { code?: string; userCancelled?: boolean | null };
      if (purchaseError.userCancelled === true || purchaseError.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
        throw new PurchaseCancelledError();
      }
      throw error;
    }
  });
}

export function restorePurchases(userId: string): Promise<void> {
  return serialize(async () => {
    await requireExpectedIdentity(userId);
    await Purchases.restorePurchases();
  });
}
