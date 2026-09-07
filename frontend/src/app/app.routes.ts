import { Routes } from '@angular/router';
import { SupplierImport } from './supplier/supplier-import/supplier-import';
import { ProductImport } from './product/product-import/product-import';
import { BookedProductImport } from './booked_product/booked-product-import/booked-product-import';
import { SearchBookedProduct } from './booked_product/search-booked-product/search-booked-product';
import { LandingPage } from './landing/landing-page';
import { Login } from './auth/login/login';
import { adminGuard } from './auth/auth.guard';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: '', component: LandingPage, canActivate: [adminGuard] },
  { path: 'supplier', component: SupplierImport, canActivate: [adminGuard] },
  { path: 'product', component: ProductImport, canActivate: [adminGuard] },
  { path: 'bookedProduct', component: BookedProductImport, canActivate: [adminGuard] },
  { path: 'search', component: SearchBookedProduct, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
