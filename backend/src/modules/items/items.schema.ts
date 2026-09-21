import { z } from 'zod';

export const variantInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Pack name is required.').max(80),
  sku: z.string().min(1, 'SKU is required.').max(60),
  barcode: z.string().max(60).nullish(),
  pack_size: z.coerce.number().positive('Pack size must be greater than zero.'),
  pack_unit: z.string().min(1),
  purchase_price: z.coerce.number().min(0).default(0),
  selling_price: z.coerce.number().min(0).default(0),
  mrp: z.coerce.number().min(0).default(0),
  min_stock: z.coerce.number().min(0).default(0),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export const itemInputSchema = z.object({
  name: z.string().min(2, 'Item name is required.').max(200),
  item_code: z.string().min(1, 'Item code is required.').max(60),
  description: z.string().max(1000).nullish(),
  item_group_id: z.string().uuid().nullish(),
  brand_id: z.string().uuid().nullish(),
  category_id: z.string().uuid().nullish(),
  hsn_code: z.string().max(20).nullish(),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  stock_unit: z.string().min(1, 'Stock unit is required.'),
  is_active: z.boolean().default(true),
  variants: z
    .array(variantInputSchema)
    .min(1, 'Add at least one packaging variant.')
    .refine((v) => new Set(v.map((x) => x.sku.toLowerCase())).size === v.length, {
      message: 'Two variants share the same SKU.',
    })
    .refine((v) => v.filter((x) => x.is_default).length <= 1, {
      message: 'Only one variant can be the default.',
    }),
});

export const itemSearchSchema = z.object({
  q: z.string().max(120).optional(),
  brandId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  lowStockOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  pricedOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(2000).default(30),
});

export type VariantInput = z.infer<typeof variantInputSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type ItemSearchQuery = z.infer<typeof itemSearchSchema>;
