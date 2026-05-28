export type UserMode = "worker" | "employer";

export type OrderStatus =
  | "published"
  | "responded"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "disputed";

export type User = {
  id: string;
  email: string;
  phone?: string | null;
  full_name: string;
  active_mode: UserMode;
  rating_avg: string;
  reviews_count: number;
  completed_orders: number;
  posted_orders: number;
  balance: string;
};

export type Order = {
  id: string;
  employer_id: string;
  assigned_worker_id?: string | null;
  title: string;
  description?: string | null;
  category: string;
  price: string;
  address: string;
  lat: string;
  lng: string;
  scheduled_at?: string | null;
  status: OrderStatus;
  escrow_amount: string;
  created_at: string;
  distance_km?: number | null;
  employer_name?: string | null;
  employer_rating_avg?: string | null;
  employer_reviews_count?: number | null;
};

export type OrderResponse = {
  id: string;
  order_id: string;
  worker_id: string;
  comment?: string | null;
  status: string;
  created_at: string;
};

export type Message = {
  id: string;
  order_id: string;
  author_id: string;
  text: string;
  created_at: string;
};
