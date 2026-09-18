import { Routes } from '@angular/router';
import { SupplierImport } from './supplier/supplier-import/supplier-import';
import { ProductImport } from './product/product-import/product-import';
import { BookedProductImport } from './booked_product/booked-product-import/booked-product-import';
import { SearchBookedProduct } from './booked_product/search-booked-product/search-booked-product';
import { LandingPage } from './landing/landing-page';
import { Login } from './auth/login/login';
import { adminGuard } from './auth/auth.guard';
import { CatalogSearch } from './catalog/catalog-search/catalog-search';
import { AnalyticsDashboard } from './analytics/dashboard/analytics-dashboard';
import { SupplierDetail } from './analytics/supplier-detail/supplier-detail';
import { ProductDetail } from './analytics/product-detail/product-detail';
import { BookedProductDetail } from './booked_product/booked-product-detail/booked-product-detail';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: '', component: LandingPage, canActivate: [adminGuard] },
  { path: 'supplier', component: SupplierImport, canActivate: [adminGuard] },
  { path: 'product', component: ProductImport, canActivate: [adminGuard] },
  { path: 'bookedProduct', component: BookedProductImport, canActivate: [adminGuard] },
  { path: 'search', component: SearchBookedProduct, canActivate: [adminGuard] },
  { path: 'catalog-search', component: CatalogSearch, canActivate: [adminGuard] },
  { path: 'analytics', component: AnalyticsDashboard, canActivate: [adminGuard] },
  { path: 'analytics/suppliers/:id', component: SupplierDetail, canActivate: [adminGuard] },
  { path: 'analytics/products/:id', component: ProductDetail, canActivate: [adminGuard] },
  { path: 'booked-product/:id', component: BookedProductDetail, canActivate: [adminGuard] },
  { path: '**', redirectTo: '' },
];
