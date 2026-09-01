import { Routes } from '@angular/router';
import {ImportComponent} from './supplier/import/import';
import {ProductImport} from './product/product-import/product-import';
import {BookedProductImport} from './booked_product/booked-product-import/booked-product-import';

export const routes: Routes = [
    {path:'test', component: ImportComponent},
    {path:'product', component: ProductImport},
    {path:'bookedProduct', component: BookedProductImport}

];
