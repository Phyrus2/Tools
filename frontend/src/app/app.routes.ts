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
import { ContractMonitoring } from './contract-monitoring/contract-monitoring';
import { HotelOptions } from './hotel-options/hotel-options';
import { ContractHub } from './contract-hub/contract-hub';
import { ModuleDirectory } from './module-directory/module-directory';
import { Forbidden } from './auth/forbidden/forbidden';
import { UserManagement } from './user-management/user-management';
import { Profile } from './profile/profile';
import { StopSales } from './stop-sales/stop-sales';

export const routes: Routes = [
  { path: 'login', component: Login },
  { path: 'forbidden', component: Forbidden },
  { path: '', component: LandingPage, canActivate: [adminGuard] },
  { path: 'profile', component: Profile, canActivate: [adminGuard] },
  {
    path: 'import-module',
    component: ModuleDirectory,
    canActivate: [adminGuard],
    data: {
      anyPermissions: ['supplier_import', 'product_import', 'booked_product_import'],
      eyebrow: 'DATA SYNCHRONIZATION',
      title: 'Import Module',
      description: 'Upload and synchronize master and transactional data from Excel files.',
      tools: [
        { number: '01', code: 'SUP', eyebrow: 'MASTER DATA', title: 'Supplier Import', description: 'Manage supplier records, locations, and categories.', action: 'Open supplier import', route: '/supplier', tone: 'forest', permission: 'supplier_import' },
        { number: '02', code: 'PRO', eyebrow: 'PRODUCT CATALOG', title: 'Product Import', description: 'Update products and their supplier relationships.', action: 'Open product import', route: '/product', tone: 'blue', permission: 'product_import' },
        { number: '03', code: 'BKG', eyebrow: 'TRANSACTION DATA', title: 'Booked Product Import', description: 'Import and review booked product transactions.', action: 'Open booked product import', route: '/bookedProduct', tone: 'gold', permission: 'booked_product_import' },
      ],
    },
  },
  {
    path: 'search-module',
    component: ModuleDirectory,
    canActivate: [adminGuard],
    data: {
      anyPermissions: ['catalog_search', 'booking_search'],
      eyebrow: 'OPERATIONAL LOOKUP',
      title: 'Search Module',
      description: 'Find supplier, product, and booking information from focused search tools.',
      tools: [
        { number: '01', code: 'CAT', eyebrow: 'MASTER DATA SEARCH', title: 'Supplier & Product Search', description: 'Search supplier and product master data without mixing result types.', action: 'Open catalog search', route: '/catalog-search', tone: 'forest', permission: 'catalog_search' },
        { number: '02', code: 'BKG', eyebrow: 'BOOKING SEARCH', title: 'Booked Product Search', description: 'Search bookings by product, supplier, location, person in charge, or date.', action: 'Open booking search', route: '/search', tone: 'plum', permission: 'booking_search' },
      ],
    },
  },
  { path: 'supplier', component: SupplierImport, canActivate: [adminGuard], data: { permission: 'supplier_import' } },
  { path: 'product', component: ProductImport, canActivate: [adminGuard], data: { permission: 'product_import' } },
  { path: 'bookedProduct', component: BookedProductImport, canActivate: [adminGuard], data: { permission: 'booked_product_import' } },
  { path: 'search', component: SearchBookedProduct, canActivate: [adminGuard], data: { permission: 'booking_search' } },
  { path: 'catalog-search', component: CatalogSearch, canActivate: [adminGuard], data: { permission: 'catalog_search' } },
  { path: 'analytics', component: AnalyticsDashboard, canActivate: [adminGuard], data: { permission: 'analytics' } },
  { path: 'analytics/suppliers/:id', component: SupplierDetail, canActivate: [adminGuard], data: { permission: 'analytics' } },
  { path: 'analytics/products/:id', component: ProductDetail, canActivate: [adminGuard], data: { permission: 'analytics' } },
  { path: 'booked-product/:id', component: BookedProductDetail, canActivate: [adminGuard], data: { anyPermissions: ['analytics', 'booking_search', 'booked_product_import'] } },
  { path: 'contract-monitoring', component: ContractMonitoring, canActivate: [adminGuard], data: { permission: 'contract_monitoring' } },
  { path: 'stop-sales', component: StopSales, canActivate: [adminGuard], data: { permission: 'stop_sales' } },
  { path: 'contract', component: ContractHub, canActivate: [adminGuard], data: { anyPermissions: ['contract_monitoring', 'hotel_options', 'stop_sales'] } },
  { path: 'hotel-options', redirectTo: 'hotel-options/2026', pathMatch: 'full' },
  { path: 'hotel-options/:year', component: HotelOptions, canActivate: [adminGuard], data: { permission: 'hotel_options' } },
  { path: 'users', component: UserManagement, canActivate: [adminGuard], data: { permission: 'user_management' } },
  { path: '**', redirectTo: '' },
];
