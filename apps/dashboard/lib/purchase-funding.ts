export const purchaseUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export const fundingStatuses = ['UNFUNDED', 'PARTIALLY_FUNDED', 'FULLY_FUNDED'] as const;

export type PurchaseFunding = {
  purchaseId: string;
  currency: 'SAR';
  purchasePrice: string;
  allocatedAmount: string;
  remainingAmount: string;
  fundingStatus: typeof fundingStatuses[number];
};
