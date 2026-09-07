import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProductImport } from './product-import';
import { provideRouter } from '@angular/router';

describe('ProductImport', () => {
  let component: ProductImport;
  let fixture: ComponentFixture<ProductImport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductImport],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductImport);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
