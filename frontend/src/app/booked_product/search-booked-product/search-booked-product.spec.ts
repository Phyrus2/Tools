import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SearchBookedProduct } from './search-booked-product';
import { provideRouter } from '@angular/router';

describe('SearchBookedProduct', () => {
  let component: SearchBookedProduct;
  let fixture: ComponentFixture<SearchBookedProduct>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchBookedProduct],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchBookedProduct);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
