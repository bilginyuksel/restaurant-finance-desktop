export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'pcs';

export type UserRoleType = 'admin' | 'waiter';

export interface StaffPermissions {
  canSeeHistoryPrices: boolean;
  canSeeHistoryTotal: boolean;
  canRemoveTableItems: boolean;
  canDeleteTables: boolean;
  canUpdateOrders: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  surname?: string;
  restaurantId: string;
  role: UserRoleType;
}

export interface TableLayout {
  /** Per-group placeholder slot counts, keyed by TableGroup.id. */
  groupPresets?: Record<string, number>;
  /** Per-group label prefixes. Defaults to the first two uppercase letters of the group name. */
  groupPrefixes?: Record<string, string>;
}

export interface Restaurant {
  id: string;
  name: string;
  ownerId: string;
  currency: string;
  settings?: {
    staffPermissions: StaffPermissions;
    tableLayout?: TableLayout;
  };
}

export interface BaseResource {
  createdBy?: string;
  createdAt?: number;
  createdByName?: string;
}

export interface Ingredient extends BaseResource {
  id: string;
  name: string;
  unit: Unit;
  cost: number;
}

export interface RecipeIngredient {
  ingredientId: string;
  amount: number;
  unit: Unit;
}

export interface VariationOption {
  id: string;
  name: string;
}

export interface VariationGroup {
  id: string;
  label: string;
  mode: 'single' | 'multi';
  required?: boolean;
  options: VariationOption[];
}

export interface SelectedVariation {
  groupId: string;
  groupLabel: string;
  optionIds: string[];
  optionNames: string[];
}

export interface Recipe extends BaseResource {
  id: string;
  name: string;
  price: number;
  category?: string;
  pricingType?: 'fixed' | 'by_weight';
  ingredients: RecipeIngredient[];
  variationGroups?: VariationGroup[];
}

export interface DailySaleItem {
  recipeId: string;
  quantity: number;
  price?: number;
  cost?: number;
  productSnapshot?: Recipe;
}

export interface DailySale extends BaseResource {
  id: string;
  date: string;
  items: DailySaleItem[];
  totalCash?: number;
  totalCard?: number;
}

export interface TableItem extends BaseResource {
  recipeId: string;
  quantity: number;
  paymentStatus?: 'pending' | 'paid';
  price?: number;
  cost?: number;
  productSnapshot?: Recipe;
  selectedVariations?: SelectedVariation[];
}

export interface TableOrder extends BaseResource {
  id: string;
  items: TableItem[];
  updatedBy?: string;
  updatedAt?: number;
  updatedByName?: string;
}

/**
 * How the cashier chose to apply this payment.
 * - 'all'   : settle every unpaid item on the table
 * - 'amount': settle by an arbitrary amount (no item linkage)
 * - 'items' : settle a specific subset of items
 * Older records (created before this field existed) will be missing it.
 */
export type PaymentMode = 'all' | 'amount' | 'items';

export interface Transaction {
  id: string;
  tableId: string;
  /**
   * Actual money that hit the drawer / card terminal — i.e. the value after
   * any discount and any cash-rounding adjustment.
   */
  amount: number;
  /**
   * Nominal value of the items / bill portion being settled by this
   * transaction, *before* discount and rounding. Used for "how much of the
   * table total has been covered" math so that discounts correctly close the
   * bill. Older records may not have this — fall back to `amount`.
   */
  grossAmount?: number;
  /** Positive discount amount that was applied to grossAmount. */
  discount?: number;
  /**
   * Signed rounding delta applied after discount. Positive = customer paid up
   * to a round number, negative = rounded down in their favor. Adds to
   * `(grossAmount - discount)` to produce `amount`.
   */
  rounding?: number;
  /** Which payment mode the cashier used; informational. */
  mode?: PaymentMode;
  /**
   * True if this transaction was recorded before the table had any orders
   * (deposit / pre-payment). Useful for reporting and for distinguishing a
   * deposit that later got applied vs. a regular partial pay.
   */
  isPrepayment?: boolean;
  paymentMethod: 'cash' | 'credit_card';
  items?: TableItem[];
  createdAt: number;
  createdBy?: string;
  createdByName?: string;
}

export interface TableGroup {
  id: string;
  name: string;
  order?: number;
}

export interface Table {
  id: string;
  name: string;
  group?: string;
  status: 'active' | 'closed';
  createdAt: string;
  closedAt?: string;
  orders: TableOrder[];
  totalPrice: number;
  transactions?: Transaction[];
  mergedTables?: string[];
  paymentMethod?: 'cash' | 'credit_card';
  receiptPrinted?: boolean;
}
