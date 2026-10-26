import { integer, jsonb, pgTable } from "drizzle-orm/pg-core";

export interface IssuerProfile {
  name: string;
  nit: string;
  ircc: string;
  address: string;
  organization: string;
  paymentBeneficiary: string;
  bankAccount: string;
  bankBranch: string;
  bankName: string;
}

export interface LegalDocument {
  useStamp: boolean;
  useSignature: boolean;
  confirm: true;
  issuer: IssuerProfile;
  preparedBy: string;
  preparedPosition: string;
  deliveredBy: string;
  accountedBy: string;
  transportedBy: string;
  transportId: string;
  vehiclePlate: string;
  drivingLicense: string;
  receivedBy: string;
  receivedPosition: string;
  receivedId: string;
  customerIrcc: string;
  customerBankAccount: string;
  stampPath: string | null;
  signaturePath: string | null;
  authorizedAt: string;
  authorizedBy: string;
}

export interface LegalImageSnapshot {
  stampPath: string | null;
  signaturePath: string | null;
}

export const issuerSettingsTable = pgTable("issuer_settings", {
  id: integer("id").primaryKey(),
  profile: jsonb("profile").$type<IssuerProfile>().notNull(),
  stampPath: jsonb("stamp_path").$type<string | null>(),
  signaturePath: jsonb("signature_path").$type<string | null>(),
  authorization: jsonb("authorization").$type<{ source: string; approvedAt: string }>(),
});
