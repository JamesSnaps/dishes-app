"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ShoppingCountValue {
  count: number;
  setCount: (n: number) => void;
}

const ShoppingCountContext = createContext<ShoppingCountValue | null>(null);

export function ShoppingCountProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  return (
    <ShoppingCountContext.Provider value={{ count, setCount }}>
      {children}
    </ShoppingCountContext.Provider>
  );
}

/** Live unchecked shopping-list count, kept in sync by the shopping list view. */
export function useShoppingCount() {
  return useContext(ShoppingCountContext);
}
