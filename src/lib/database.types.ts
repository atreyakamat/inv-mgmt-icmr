/**
 * Types for the `inventory` schema. Kept in step with supabase/migrations by hand;
 * regenerate with `supabase gen types` once the schema is exposed if preferred.
 */

export type RequestStatus =
  | "submitted"
  | "recommended"
  | "not_recommended"
  | "approved"
  | "fulfilled"
  | "rejected"
  | "cancelled";

export type MovementKind = "receive" | "issue" | "adjust" | "transfer_out" | "transfer_in";

export type PermissionKey =
  | "catalog.write"
  | "stock.write"
  | "stock.read_history"
  | "requests.submit"
  | "requests.read_all"
  | "requests.review"
  | "requests.approve"
  | "requests.fulfill"
  | "users.manage"
  | "roles.manage"
  | "audit.read";

type Timestamps = { created_at: string; updated_at: string };

export type Permission = { key: PermissionKey; description: string; sort_order: number };

export type Role = Timestamps & {
  id: number;
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_locked: boolean;
  hidden: boolean;
  max_members: number | null;
};

export type RolePermission = { role_id: number; permission_key: PermissionKey };

export type Profile = Timestamps & {
  id: string;
  email: string;
  full_name: string;
  role_id: number;
  active: boolean;
  created_by: string | null;
};

export type Category = Timestamps & {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  created_by: string | null;
};

export type Location = Category;

export type Item = Timestamps & {
  id: number;
  sku: string | null;
  name: string;
  description: string | null;
  category_id: number;
  unit: string;
  reorder_level: number;
  active: boolean;
  created_by: string | null;
};

export type RequestRow = Timestamps & {
  id: number;
  requester_id: string;
  location_id: number;
  purpose: string;
  needed_by: string | null;
  status: RequestStatus;
  reviewer_id: string | null;
  reviewer_note: string | null;
  reviewed_at: string | null;
  approver_id: string | null;
  approver_note: string | null;
  approved_at: string | null;
  fulfiller_id: string | null;
  fulfiller_note: string | null;
  closed_at: string | null;
};

export type RequestLine = {
  id: number;
  request_id: number;
  item_id: number;
  requested_qty: number;
  approved_qty: number | null;
};

export type RequestEvent = {
  id: number;
  request_id: number;
  actor_id: string | null;
  from_status: RequestStatus | null;
  to_status: RequestStatus;
  note: string | null;
  created_at: string;
};

export type StockMovement = {
  id: number;
  item_id: number;
  location_id: number;
  kind: MovementKind;
  quantity: number;
  request_id: number | null;
  transfer_group: string | null;
  batch_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type StockLevel = {
  item_id: number;
  location_id: number;
  quantity: number;
  updated_at: string;
};

export type AuditEntry = {
  id: number;
  actor_id: string | null;
  actor_kind: "member" | "server" | "system";
  action: string;
  table_name: string | null;
  row_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
};

export type LowStock = {
  item_id: number;
  item_name: string;
  sku: string | null;
  unit: string;
  reorder_level: number;
  /** total across active locations */
  quantity: number;
  /** e.g. "Lab 1 2, Main store 3"; empty when none left anywhere */
  held_at: string;
};

/** Shape returned by inventory.me() */
export type Me = {
  id: string;
  email: string;
  full_name: string;
  active: boolean;
  role: { id: number; key: string; name: string; hidden: boolean };
  mfa_verified: boolean;
  permissions: PermissionKey[];
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type Database = {
  inventory: {
    Tables: {
      permissions: Table<Permission>;
      roles: Table<Role>;
      role_permissions: Table<RolePermission>;
      profiles: Table<Profile, Pick<Profile, "id" | "email" | "full_name" | "role_id"> & Partial<Profile>>;
      categories: Table<Category, Pick<Category, "name"> & Partial<Category>>;
      locations: Table<Location, Pick<Location, "name"> & Partial<Location>>;
      items: Table<Item, Pick<Item, "name" | "category_id"> & Partial<Item>>;
      requests: Table<RequestRow>;
      request_lines: Table<RequestLine>;
      request_events: Table<RequestEvent>;
      stock_movements: Table<StockMovement>;
      stock_levels: Table<StockLevel>;
      audit_log: Table<AuditEntry>;
    };
    Views: {
      low_stock: { Row: LowStock; Relationships: [] };
    };
    Functions: {
      me: Fn<Record<string, never>, Me | null>;
      my_permissions: Fn<Record<string, never>, PermissionKey[]>;
      update_my_name: Fn<{ p_full_name: string }, undefined>;
      set_member_role: Fn<{ p_user_id: string; p_role_id: number }, undefined>;
      set_member_active: Fn<{ p_user_id: string; p_active: boolean }, undefined>;
      create_role: Fn<{ p_key: string; p_name: string; p_description: string | null; p_permissions: string[] }, number>;
      update_role: Fn<{ p_role_id: number; p_name: string; p_description: string | null; p_permissions: string[] }, undefined>;
      delete_role: Fn<{ p_role_id: number }, undefined>;
      submit_request: Fn<
        { p_location_id: number; p_purpose: string; p_lines: { item_id: number; quantity: number }[]; p_needed_by: string | null },
        number
      >;
      cancel_request: Fn<{ p_id: number; p_note: string | null }, undefined>;
      review_request: Fn<{ p_id: number; p_recommend: boolean; p_note: string | null }, undefined>;
      approve_request: Fn<
        { p_id: number; p_lines: { line_id: number; approved_qty: number }[] | null; p_note: string | null },
        undefined
      >;
      reject_request: Fn<{ p_id: number; p_note: string }, undefined>;
      fulfill_request: Fn<{ p_id: number; p_note: string | null }, undefined>;
      receive_stock: Fn<{ p_item_id: number; p_location_id: number; p_quantity: number; p_note: string | null }, undefined>;
      adjust_stock: Fn<{ p_item_id: number; p_location_id: number; p_delta: number; p_note: string }, undefined>;
      receive_delivery: Fn<
        {
          p_location_id: number;
          p_reference: string | null;
          p_lines: Array<
            | { item_id: number; quantity: number }
            | { new_item: { name: string; category_id: number; unit: string; sku: string | null; reorder_level: number }; quantity: number }
          >;
        },
        string
      >;
      transfer_stock: Fn<
        { p_item_id: number; p_from_location: number; p_to_location: number; p_quantity: number; p_note: string | null },
        undefined
      >;
    };
    Enums: {
      request_status: RequestStatus;
      movement_kind: MovementKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
