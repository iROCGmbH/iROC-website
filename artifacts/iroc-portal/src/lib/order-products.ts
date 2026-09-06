import type { PortalProductGroup } from '@workspace/api-client-react';

export type OrderMode = 'product' | 'service';
export type ProductSelection = Record<number, number>;

export function buildPortalOrderProducts(
  productGroups: PortalProductGroup[],
  selection: ProductSelection,
  mode: OrderMode,
) {
  if (mode !== 'product') return [];

  const allProducts = productGroups.flatMap(group => group.products ?? []);

  return Object.entries(selection)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const productId = Number(id);
      const product = allProducts.find(candidate => candidate.id === productId);

      return {
        productId,
        name: product?.nameDe ?? product?.nameEn ?? String(productId),
        quantity,
        category: product?.category ?? '',
      };
    });
}