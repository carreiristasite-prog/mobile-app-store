import type { MonthlyOffering } from './purchases.types';

export async function syncPurchasesIdentity(_userId: string | null): Promise<boolean> {
  return false;
}

export function resetPurchasesCache(): void {}

export async function getMonthlyOffering(): Promise<MonthlyOffering | null> {
  return null;
}

export async function purchaseMonthly(): Promise<void> {
  throw new Error('A assinatura deve ser gerenciada pela App Store ou Google Play.');
}

export async function restorePurchases(): Promise<void> {
  throw new Error('A restauração deve ser feita no aplicativo para iOS ou Android.');
}
