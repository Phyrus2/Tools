import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookedProductImport } from './booked-product-import';

describe('BookedProductImport', () => {
  let component: BookedProductImport;
  let fixture: ComponentFixture<BookedProductImport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BookedProductImport],
    }).compileComponents();

    fixture = TestBed.createComponent(BookedProductImport);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
