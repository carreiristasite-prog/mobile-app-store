export type MonthlyOffering = {
  productId: 'iaaprova.pro.monthly' | 'iaaprova.pro.monthly:monthly-auto-renewing';
  localizedPrice: string;
  available: boolean;
};

export class PurchaseCancelledError extends Error {
  constructor() {
    super('Compra cancelada pelo usuário.');
    this.name = 'PurchaseCancelledError';
  }
}
