import Dexie, { type Table } from "dexie";

export interface CachedShoppingItem {
  id: string;
  listId: string;
  ingredientName: string;
  amount: string | null;
  unit: string | null;
  notes: string | null;
  isChecked: boolean;
  category: string | null;
  position: number;
  recipeId: string | null;
  recipeTitle: string | null;
}

export interface PendingMutation {
  id?: number;
  url: string;
  method: string;
  body: string;
  createdAt: number;
}

class ShoppingDB extends Dexie {
  items!: Table<CachedShoppingItem>;
  pendingMutations!: Table<PendingMutation>;

  constructor() {
    super("dishes-shopping");
    this.version(1).stores({
      items: "id, listId, position",
      pendingMutations: "++id, createdAt",
    });
  }
}

export const shoppingDB = new ShoppingDB();
