export interface InvoiceSeriesInput {
  /**
     * @minLength 1
     * @maxLength 80
     */
  name: string;
  /**
     * @maxLength 20
     * @pattern ^[A-Za-z0-9_-]*$
     */
  prefix: string;
  /**
     * @maxLength 10
     * @pattern ^[A-Za-z0-9_-]*$
     */
  suffix: string;
  /**
     * @minimum 1
     * @maximum 10
     */
  width: number;
  /**
     * @maxLength 20
     * @pattern ^[0-9]+$
     */
  talon: string;
  /**
     * @minimum 0
     * @maximum 2147483646
     */
  nextNumber: number;
  confirmedWithVersat: true;
}

export interface InvoiceSeriesUpdate {
  active: boolean;
  /**
     * @minimum 0
     * @maximum 2147483647
     */
  nextNumber: number;
  confirmedWithVersat: true;
}

export interface InvoiceSeries {
  id: number;
  name: string;
  prefix: string;
  suffix: string;
  width: number;
  talon: string;
  nextNumber: number;
  active: boolean;
}

export interface IssuerProfile {
  /**
     * @minLength 1
     * @maxLength 200
     */
  name: string;
  /**
     * @minLength 1
     * @maxLength 40
     */
  nit: string;
  /**
     * @minLength 1
     * @maxLength 80
     */
  ircc: string;
  /**
     * @minLength 1
     * @maxLength 400
     */
  address: string;
  /**
     * @minLength 1
     * @maxLength 100
     */
  organization: string;
  /**
     * @minLength 1
     * @maxLength 200
     */
  paymentBeneficiary: string;
  /**
     * @minLength 1
     * @maxLength 80
     */
  bankAccount: string;
  /**
     * @minLength 1
     * @maxLength 80
     */
  bankBranch: string;
  /**
     * @minLength 1
     * @maxLength 200
     */
  bankName: string;
}

export interface IssuerSettings {
  profile: IssuerProfile | null;
  hasStamp: boolean;
  hasSignature: boolean;
}

export interface DocumentAuthorization {
  /**
     * @minLength 1
     * @maxLength 160
     */
  preparedBy: string;
  /**
     * @minLength 1
     * @maxLength 160
     */
  preparedPosition: string;
  /** @maxLength 160 */
  deliveredBy: string;
  /** @maxLength 160 */
  accountedBy: string;
  /** @maxLength 160 */
  transportedBy: string;
  /** @maxLength 40 */
  transportId: string;
  /** @maxLength 40 */
  vehiclePlate: string;
  /** @maxLength 40 */
  drivingLicense: string;
  /** @maxLength 160 */
  receivedBy: string;
  /** @maxLength 160 */
  receivedPosition: string;
  /** @maxLength 40 */
  receivedId: string;
  /** @maxLength 80 */
  customerIrcc: string;
  /** @maxLength 80 */
  customerBankAccount: string;
  useStamp: boolean;
  useSignature: boolean;
  confirm: true;
}

export type LegalDocument = DocumentAuthorization & ({
  issuer: IssuerProfile;
  /** @nullable */
  stampPath: string | null;
  /** @nullable */
  signaturePath: string | null;
  authorizedAt: string;
});

export interface HealthStatus {
  status: string;
}

export interface Customer {
  id: number;
  name: string;
  /** @nullable */
  versatCode?: string | null;
  /** @nullable */
  versatSourceId?: number | null;
  /** @nullable */
  ircc?: string | null;
  /** @nullable */
  email: string | null;
  /** @nullable */
  phone: string | null;
  /** @nullable */
  taxId: string | null;
  /** @nullable */
  address: string | null;
  /** @nullable */
  notes: string | null;
  active: boolean;
  createdAt: string;
}

export interface CustomerInput {
  /** @minLength 1 */
  name: string;
  /**
     * @maxLength 40
     * @nullable
     */
  versatCode?: string | null;
  /** @nullable */
  ircc?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  phone?: string | null;
  /** @nullable */
  taxId?: string | null;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  notes?: string | null;
}

export interface InvoiceLine {
  id: number;
  description: string;
  /** @nullable */
  serviceId?: number | null;
  /** @nullable */
  serviceCode?: string | null;
  /** @nullable */
  groupCode?: string | null;
  /** @nullable */
  unitCode?: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceLineInput {
  /** @minLength 1 */
  description: string;
  /** @nullable */
  serviceId?: number | null;
  /**
     * @maxLength 40
     * @nullable
     * @pattern ^[A-Za-z0-9.-]*$
     */
  groupCode?: string | null;
  /**
     * @maximum 999999999
     * @exclusiveMinimum 0
     */
  quantity: number;
  /**
     * @minimum 0
     * @maximum 999999999999
     */
  unitPrice: number;
}

export type InvoiceStatus = typeof InvoiceStatus[keyof typeof InvoiceStatus];


export const InvoiceStatus = {
  draft: 'draft',
  finished: 'finished',
  accepted: 'accepted',
  confirmed: 'confirmed',
  voided: 'voided',
  cancelled: 'cancelled',
  error: 'error',
  sent: 'sent',
  paid: 'paid',
} as const;

export type InvoicePaymentStatus = typeof InvoicePaymentStatus[keyof typeof InvoicePaymentStatus];


export const InvoicePaymentStatus = {
  pending: 'pending',
  paid: 'paid',
} as const;

export interface VersatInvoiceInput {
  conceptId: number;
  operationId: number;
  commercialId: number;
  paymentId: number;
  /**
     * @maxLength 50
     * @nullable
     * @pattern ^[A-Za-z0-9_-]*$
     */
  number?: string | null;
  /**
     * @maxLength 20
     * @nullable
     * @pattern ^[0-9]*$
     */
  talon?: string | null;
  /**
     * @maxLength 100
     * @nullable
     */
  bankAccountMC?: string | null;
  /**
     * @maxLength 100
     * @nullable
     */
  bankAccountOM?: string | null;
  /**
     * @maxLength 100
     * @nullable
     */
  contract?: string | null;
}

export type VersatInvoiceSnapshot = VersatInvoiceInput & ({
  currencyName: string;
  conceptCode: string;
  operationName: string;
  commercialName: string;
  commercialPosition: string;
  paymentName: string;
  /** @nullable */
  customerCode: string | null;
  customerName: string;
  /** @nullable */
  customerAddress: string | null;
  /** @nullable */
  customerTaxId: string | null;
});

export interface Invoice {
  /** @nullable */
  seriesId?: number | null;
  id: number;
  number: string;
  customerId: number;
  customerName: string;
  specialistId: string;
  specialistName: string;
  issueDate: string;
  /** @nullable */
  dueDate: string | null;
  currency: string;
  status: InvoiceStatus;
  /**
     * @minimum 1
     * @maximum 7
     * @nullable
     */
  statusCode?: number | null;
  paymentStatus: InvoicePaymentStatus;
  /** @nullable */
  paidAt: string | null;
  /** @nullable */
  acceptedAt?: string | null;
  /** @nullable */
  confirmedAt?: string | null;
  /** @nullable */
  notes: string | null;
  versat?: VersatInvoiceSnapshot | null;
  legalDocument?: LegalDocument | null;
  subtotal: number;
  total: number;
  lines: InvoiceLine[];
  createdAt: string;
}

export interface InvoiceInput {
  /**
     * @minimum 1
     * @nullable
     */
  seriesId?: number | null;
  customerId: number;
  issueDate: string;
  /** @nullable */
  dueDate?: string | null;
  /** @minLength 1 */
  currency: string;
  /** @nullable */
  notes?: string | null;
  versat?: VersatInvoiceInput;
  /** @minItems 1 */
  lines: InvoiceLineInput[];
}

export type InvoicePaymentInputPaymentStatus = typeof InvoicePaymentInputPaymentStatus[keyof typeof InvoicePaymentInputPaymentStatus];


export const InvoicePaymentInputPaymentStatus = {
  paid: 'paid',
} as const;

export interface InvoicePaymentInput {
  paymentStatus: InvoicePaymentInputPaymentStatus;
}

export type InvoiceStatusInputStatus = typeof InvoiceStatusInputStatus[keyof typeof InvoiceStatusInputStatus];


export const InvoiceStatusInputStatus = {
  draft: 'draft',
  finished: 'finished',
  accepted: 'accepted',
  confirmed: 'confirmed',
  voided: 'voided',
  cancelled: 'cancelled',
  error: 'error',
} as const;

export interface InvoiceStatusInput {
  status: InvoiceStatusInputStatus;
}

export interface InvoiceShare {
  url: string;
  expiresAt: string;
}

export interface InvoiceExportRow {
  id?: number;
  /** @nullable */
  versatNumber?: string | null;
  canExport?: boolean;
  issues?: string[];
  invoiceNumber: string;
  issueDate: string;
  customerName: string;
  /** @nullable */
  taxId: string | null;
  currency: string;
  subtotal: number;
  total: number;
  status: string;
}

export interface BillingOverview {
  invoiceCount: number;
  draftCount: number;
  sentCount: number;
  paidCount: number;
  finishedCount: number;
  acceptedCount: number;
  confirmedCount: number;
  monthTotal: number;
  currency: string;
  recentInvoices: Invoice[];
}

export type TeamMemberRole = typeof TeamMemberRole[keyof typeof TeamMemberRole];


export const TeamMemberRole = {
  owner: 'owner',
  specialist: 'specialist',
  pending: 'pending',
} as const;

export interface TeamMember {
  userId: string;
  name: string;
  /** @nullable */
  email: string | null;
  role: TeamMemberRole;
  /** @nullable */
  commercialId: number | null;
  suspended: boolean;
}

export interface TeamInvitationInput {
  email: string;
  /**
     * @minimum 1
     * @nullable
     */
  commercialId: number | null;
}

export interface TeamInvitation {
  email: string;
  /** @nullable */
  commercialId: number | null;
  createdAt: string;
}

export type VersatCatalogEntryKind = typeof VersatCatalogEntryKind[keyof typeof VersatCatalogEntryKind];


export const VersatCatalogEntryKind = {
  service: 'service',
  unit: 'unit',
  currency: 'currency',
  concept: 'concept',
  operation: 'operation',
  commercial: 'commercial',
  payment: 'payment',
} as const;

export interface VersatCatalogEntry {
  id: number;
  kind: VersatCatalogEntryKind;
  sourceId: number;
  code: string;
  name: string;
  /** @nullable */
  unitCode: string | null;
  /** @nullable */
  unitName: string | null;
  /** @nullable */
  groupCode: string | null;
  /** @nullable */
  position: string | null;
}

export interface VersatCatalogs {
  entries: VersatCatalogEntry[];
  customerCount: number;
}

export interface VersatDownload {
  filename: string;
  base64: string;
  contentType: string;
  invoiceCount: number;
  warnings: string[];
}

export type ListCustomersParams = {
search?: string;
};

export type ListInvoicesParams = {
search?: string;
status?: ListInvoicesStatus;
paymentStatus?: ListInvoicesPaymentStatus;
from?: string;
to?: string;
};

export type ListInvoicesStatus = typeof ListInvoicesStatus[keyof typeof ListInvoicesStatus];


export const ListInvoicesStatus = {
  draft: 'draft',
  finished: 'finished',
  accepted: 'accepted',
  confirmed: 'confirmed',
  voided: 'voided',
  cancelled: 'cancelled',
  error: 'error',
  sent: 'sent',
  paid: 'paid',
} as const;

export type ListInvoicesPaymentStatus = typeof ListInvoicesPaymentStatus[keyof typeof ListInvoicesPaymentStatus];


export const ListInvoicesPaymentStatus = {
  pending: 'pending',
  paid: 'paid',
} as const;

export type GetVersatExportFileParams = {
from: string;
to: string;
encoding?: GetVersatExportFileEncoding;
};

export type GetVersatExportFileEncoding = typeof GetVersatExportFileEncoding[keyof typeof GetVersatExportFileEncoding];


export const GetVersatExportFileEncoding = {
  'windows-1252': 'windows-1252',
  'utf-8': 'utf-8',
} as const;

export type ExportVersatInvoicesParams = {
from: string;
to: string;
};


/**
 * Generated by orval 🍺
 * Do not edit manually.
 * Api
 * API specification
 * OpenAPI spec version: 0.1.0
 */
export interface TeamMemberAccessInput {
  suspended: boolean;
}
