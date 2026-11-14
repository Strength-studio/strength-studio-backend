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

export const membershipStatuses = ['NOT_CREATED', 'PENDING_ACTIVATION', 'ACTIVE', 'EXPIRED', 'INELIGIBLE'] as const;

export type MembershipState = {
  membershipId: string | null;
  status: typeof membershipStatuses[number];
};

export type ActivationResult = {
  membership: {
    id: string;
    purchaseId: string;
    status: 'ACTIVE';
    activatedAt: string;
    validFrom: string;
    validThrough: string;
    initialSessionAllowance: number | null;
  };
  purchaseType: 'COMPLIMENTARY' | 'POSITIVE_PRICE';
  fundingStatus: PurchaseFunding['fundingStatus'];
  overrideUsed: boolean;
  overrideReason?: string;
};
