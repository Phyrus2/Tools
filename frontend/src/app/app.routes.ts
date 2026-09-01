import { Routes } from '@angular/router';
import {SupplierImport} from './supplier/supplier-import/supplier-import';
import {ProductImport} from './product/product-import/product-import';
import {BookedProductImport} from './booked_product/booked-product-import/booked-product-import';

export const routes: Routes = [
    {path:'test', component: SupplierImport},
    {path:'product', component: ProductImport},
    {path:'bookedProduct', component: BookedProductImport}

];
