import { TestBed } from '@angular/core/testing';

import { BookedProduct } from './booked-product';

describe('BookedProduct', () => {
  let service: BookedProduct;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BookedProduct);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
