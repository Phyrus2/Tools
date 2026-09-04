import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SupplierImport } from './supplier-import';

describe('SupplierImport', () => {
  let component: SupplierImport;
  let fixture: ComponentFixture<SupplierImport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupplierImport],
    }).compileComponents();

    fixture = TestBed.createComponent(SupplierImport);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
