import { Routes } from '@angular/router';
import {SupplierImport} from './supplier/supplier-import/supplier-import';
import {ProductImport} from './product/product-import/product-import';
import {BookedProductImport} from './booked_product/booked-product-import/booked-product-import';
import { SearchBookedProduct } from './booked_product/search-booked-product/search-booked-product';

export const routes: Routes = [
    {path:'test', component: SupplierImport},
    {path:'product', component: ProductImport},
    {path:'bookedProduct', component: BookedProductImport},
    {path:'search', component: SearchBookedProduct},
];
