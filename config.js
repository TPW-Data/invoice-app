// Public client config. The anon key is safe to expose; data access is limited by Row Level Security (see supabase/schema.sql).
const CONFIG = {
  SUPABASE_URL: "https://yubihvswlnrjbqbaqndp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_-VGEXODXremOrnSXm7JQrQ_uWSlxczI",
  // Expense classifications shown in the dropdown and suggested by the AI. Edit freely.
  EXPENSE_CATEGORIES: [
    "Materials",
    "Services",
    "Fuel & transport",
    "Phone & internet",
    "Rent",
    "Office supplies",
    "Other",
  ],
};
