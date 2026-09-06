/**
 * nav-links-sync
 *
 * Confirms that PAGE_LINKS entries are correctly distributed across the three
 * nav sections (flat top-level links, Products dropdown, Services dropdown)
 * and that hidden entries never appear in any section.
 *
 * Tests use a local mock array and a minimal NavBar renderer so they are
 * self-contained and do not break if PAGE_LINKS is reorganised.
 *
 * The minimal NavBar mirrors the exact logic in Navigation.tsx:
 *   - flatLinks[0]      → Home link (top-level)
 *   - flatLinks.slice(1) → remaining top-level links
 *   - productLinks      → Products dropdown section
 *   - serviceLinks      → Services dropdown section
 *   Hidden entries are never passed to any rendered section.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentType } from 'react';
import {
  PAGE_LINKS,
  flatLinks,
  productLinks,
  serviceLinks,
  PageLink,
} from '@/config/navLinks';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal placeholder component used in mock page entries. */
const Placeholder: ComponentType = () => <div />;

/** Derives the three nav arrays the same way navLinks.ts does. */
function deriveNavArrays(links: PageLink[]) {
  return {
    flat:    links.filter((l) => l.group === 'flat'),
    product: links.filter((l) => l.group === 'product'),
    service: links.filter((l) => l.group === 'service'),
  };
}

// ── Minimal NavBar renderer (mirrors Navigation.tsx structure) ────────────────
//
// data-testid attributes match semantic sections:
//   "nav-flat"     — top-level links (flatLinks[0] + flatLinks.slice(1))
//   "nav-products" — Products dropdown links (productLinks)
//   "nav-services" — Services dropdown links (serviceLinks)

function NavBar({ links }: { links: PageLink[] }) {
  const { flat, product, service } = deriveNavArrays(links);
  return (
    <nav>
      {/* Top-level flat links */}
      <ul data-testid="nav-flat">
        {flat.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>

      {/* Products dropdown */}
      <ul data-testid="nav-products">
        {product.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>

      {/* Services dropdown */}
      <ul data-testid="nav-services">
        {service.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Mock PAGE_LINKS arrays used across suites ─────────────────────────────────

const FLAT_ENTRY: PageLink = {
  href: '/flat-page',
  labelDE: 'Flach',
  labelEN: 'Flat Page',
  group: 'flat',
  component: Placeholder,
};

const PRODUCT_ENTRY: PageLink = {
  href: '/product-page',
  labelDE: 'Produkt',
  labelEN: 'Product Page',
  group: 'product',
  subDE: 'Produktuntertitel',
  subEN: 'Product subtitle',
  component: Placeholder,
};

const SERVICE_ENTRY: PageLink = {
  href: '/service-page',
  labelDE: 'Service',
  labelEN: 'Service Page',
  group: 'service',
  icon: Placeholder as ComponentType<{ className?: string }>,
  component: Placeholder,
};

const HIDDEN_ENTRY: PageLink = {
  href: '/hidden-page',
  labelDE: 'Versteckt',
  labelEN: 'Hidden Page',
  group: 'hidden',
  component: Placeholder,
};

const MIXED_ENTRIES: PageLink[] = [
  FLAT_ENTRY,
  PRODUCT_ENTRY,
  SERVICE_ENTRY,
  HIDDEN_ENTRY,
];

// ── Filter-logic unit tests ───────────────────────────────────────────────────

describe('nav filter logic – flat entries', () => {
  it('flat entry appears in flat array', () => {
    const { flat } = deriveNavArrays(MIXED_ENTRIES);
    expect(flat.map((l) => l.href)).toContain('/flat-page');
  });

  it('flat entry does not appear in product array', () => {
    const { product } = deriveNavArrays(MIXED_ENTRIES);
    expect(product.map((l) => l.href)).not.toContain('/flat-page');
  });

  it('flat entry does not appear in service array', () => {
    const { service } = deriveNavArrays(MIXED_ENTRIES);
    expect(service.map((l) => l.href)).not.toContain('/flat-page');
  });

  it('exported flatLinks contains only entries with group === "flat"', () => {
    for (const link of flatLinks) {
      expect(link.group).toBe('flat');
    }
  });

  it('all PAGE_LINKS flat entries are present in exported flatLinks', () => {
    const expected = PAGE_LINKS.filter((l) => l.group === 'flat').map((l) => l.href);
    const actual   = flatLinks.map((l) => l.href);
    for (const href of expected) {
      expect(actual).toContain(href);
    }
  });
});

describe('nav filter logic – product entries', () => {
  it('product entry appears in product array', () => {
    const { product } = deriveNavArrays(MIXED_ENTRIES);
    expect(product.map((l) => l.href)).toContain('/product-page');
  });

  it('product entry does not appear in flat array', () => {
    const { flat } = deriveNavArrays(MIXED_ENTRIES);
    expect(flat.map((l) => l.href)).not.toContain('/product-page');
  });

  it('product entry does not appear in service array', () => {
    const { service } = deriveNavArrays(MIXED_ENTRIES);
    expect(service.map((l) => l.href)).not.toContain('/product-page');
  });

  it('exported productLinks contains only entries with group === "product"', () => {
    for (const link of productLinks) {
      expect(link.group).toBe('product');
    }
  });

  it('all PAGE_LINKS product entries are present in exported productLinks', () => {
    const expected = PAGE_LINKS.filter((l) => l.group === 'product').map((l) => l.href);
    const actual   = productLinks.map((l) => l.href);
    for (const href of expected) {
      expect(actual).toContain(href);
    }
  });
});

describe('nav filter logic – service entries', () => {
  it('service entry appears in service array', () => {
    const { service } = deriveNavArrays(MIXED_ENTRIES);
    expect(service.map((l) => l.href)).toContain('/service-page');
  });

  it('service entry does not appear in flat array', () => {
    const { flat } = deriveNavArrays(MIXED_ENTRIES);
    expect(flat.map((l) => l.href)).not.toContain('/service-page');
  });

  it('service entry does not appear in product array', () => {
    const { product } = deriveNavArrays(MIXED_ENTRIES);
    expect(product.map((l) => l.href)).not.toContain('/service-page');
  });

  it('exported serviceLinks contains only entries with group === "service"', () => {
    for (const link of serviceLinks) {
      expect(link.group).toBe('service');
    }
  });

  it('all PAGE_LINKS service entries are present in exported serviceLinks', () => {
    const expected = PAGE_LINKS.filter((l) => l.group === 'service').map((l) => l.href);
    const actual   = serviceLinks.map((l) => l.href);
    for (const href of expected) {
      expect(actual).toContain(href);
    }
  });
});

describe('nav filter logic – hidden entries', () => {
  it('hidden entry does not appear in flat array', () => {
    const { flat } = deriveNavArrays(MIXED_ENTRIES);
    expect(flat.map((l) => l.href)).not.toContain('/hidden-page');
  });

  it('hidden entry does not appear in product array', () => {
    const { product } = deriveNavArrays(MIXED_ENTRIES);
    expect(product.map((l) => l.href)).not.toContain('/hidden-page');
  });

  it('hidden entry does not appear in service array', () => {
    const { service } = deriveNavArrays(MIXED_ENTRIES);
    expect(service.map((l) => l.href)).not.toContain('/hidden-page');
  });

  it('no exported flatLinks entry has group === "hidden"', () => {
    expect(flatLinks.map((l) => l.group)).not.toContain('hidden');
  });

  it('no exported productLinks entry has group === "hidden"', () => {
    expect(productLinks.map((l) => l.group)).not.toContain('hidden');
  });

  it('no exported serviceLinks entry has group === "hidden"', () => {
    expect(serviceLinks.map((l) => l.group)).not.toContain('hidden');
  });
});

// ── NavBar render tests ───────────────────────────────────────────────────────

describe('NavBar renderer – flat entries', () => {
  it('flat entry link appears in the flat section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('nav-flat');
    expect(flatSection).toContainElement(
      screen.getByRole('link', { name: 'Flat Page' }),
    );
  });

  it('flat entry link is not in the products section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('nav-products');
    const link = screen.getByRole('link', { name: 'Flat Page' });
    expect(productsSection).not.toContainElement(link);
  });

  it('flat entry link is not in the services section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('nav-services');
    const link = screen.getByRole('link', { name: 'Flat Page' });
    expect(servicesSection).not.toContainElement(link);
  });

  it('flat entry link has the correct href', () => {
    render(<NavBar links={[FLAT_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveAttribute('href', '/flat-page');
  });
});

describe('NavBar renderer – product entries', () => {
  it('product entry link appears in the products section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('nav-products');
    expect(productsSection).toContainElement(
      screen.getByRole('link', { name: 'Product Page' }),
    );
  });

  it('product entry link is not in the flat section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('nav-flat');
    const link = screen.getByRole('link', { name: 'Product Page' });
    expect(flatSection).not.toContainElement(link);
  });

  it('product entry link is not in the services section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('nav-services');
    const link = screen.getByRole('link', { name: 'Product Page' });
    expect(servicesSection).not.toContainElement(link);
  });

  it('product entry link has the correct href', () => {
    render(<NavBar links={[PRODUCT_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Product Page' })).toHaveAttribute('href', '/product-page');
  });
});

describe('NavBar renderer – service entries', () => {
  it('service entry link appears in the services section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('nav-services');
    expect(servicesSection).toContainElement(
      screen.getByRole('link', { name: 'Service Page' }),
    );
  });

  it('service entry link is not in the flat section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('nav-flat');
    const link = screen.getByRole('link', { name: 'Service Page' });
    expect(flatSection).not.toContainElement(link);
  });

  it('service entry link is not in the products section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('nav-products');
    const link = screen.getByRole('link', { name: 'Service Page' });
    expect(productsSection).not.toContainElement(link);
  });

  it('service entry link has the correct href', () => {
    render(<NavBar links={[SERVICE_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Service Page' })).toHaveAttribute('href', '/service-page');
  });
});

describe('NavBar renderer – hidden entries', () => {
  it('hidden entry does not appear in the flat section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('nav-flat');
    expect(flatSection.querySelectorAll('a')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'Hidden Page' })]),
    );
  });

  it('hidden entry does not appear in the products section', () => {
    render(<NavBar links={MIXED_ENTRIES} />);
    expect(screen.queryByRole('link', { name: 'Hidden Page' })).not.toBeInTheDocument();
  });

  it('hidden entry alone produces three empty nav sections', () => {
    render(<NavBar links={[HIDDEN_ENTRY]} />);
    expect(screen.getByTestId('nav-flat').children).toHaveLength(0);
    expect(screen.getByTestId('nav-products').children).toHaveLength(0);
    expect(screen.getByTestId('nav-services').children).toHaveLength(0);
  });
});

// ── Minimal MobileNav renderer (mirrors Navigation.tsx mobile branch) ─────────
//
// data-testid attributes match semantic sections:
//   "mobile-flat"     — top-level flat links (flatLinks[0] + flatLinks.slice(1))
//   "mobile-products" — Products section (productLinks)
//   "mobile-services" — Services section (serviceLinks)

function MobileNav({ links }: { links: PageLink[] }) {
  const { flat, product, service } = deriveNavArrays(links);
  return (
    <div>
      {/* All flat links in one section (home + remaining) */}
      <ul data-testid="mobile-flat">
        {flat.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>

      {/* Products section */}
      <ul data-testid="mobile-products">
        {product.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>

      {/* Services section */}
      <ul data-testid="mobile-services">
        {service.map((l) => (
          <li key={l.href}>
            <a href={l.href}>{l.labelEN}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── MobileNav render tests ────────────────────────────────────────────────────

describe('MobileNav renderer – flat entries', () => {
  it('flat entry link appears in the mobile flat section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('mobile-flat');
    expect(flatSection).toContainElement(
      screen.getByRole('link', { name: 'Flat Page' }),
    );
  });

  it('flat entry link is not in the mobile products section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('mobile-products');
    const link = screen.getByRole('link', { name: 'Flat Page' });
    expect(productsSection).not.toContainElement(link);
  });

  it('flat entry link is not in the mobile services section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('mobile-services');
    const link = screen.getByRole('link', { name: 'Flat Page' });
    expect(servicesSection).not.toContainElement(link);
  });

  it('flat entry link has the correct href in mobile nav', () => {
    render(<MobileNav links={[FLAT_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveAttribute('href', '/flat-page');
  });
});

describe('MobileNav renderer – product entries', () => {
  it('product entry link appears in the mobile products section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('mobile-products');
    expect(productsSection).toContainElement(
      screen.getByRole('link', { name: 'Product Page' }),
    );
  });

  it('product entry link is not in the mobile flat section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('mobile-flat');
    const link = screen.getByRole('link', { name: 'Product Page' });
    expect(flatSection).not.toContainElement(link);
  });

  it('product entry link is not in the mobile services section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('mobile-services');
    const link = screen.getByRole('link', { name: 'Product Page' });
    expect(servicesSection).not.toContainElement(link);
  });

  it('product entry link has the correct href in mobile nav', () => {
    render(<MobileNav links={[PRODUCT_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Product Page' })).toHaveAttribute('href', '/product-page');
  });
});

describe('MobileNav renderer – service entries', () => {
  it('service entry link appears in the mobile services section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('mobile-services');
    expect(servicesSection).toContainElement(
      screen.getByRole('link', { name: 'Service Page' }),
    );
  });

  it('service entry link is not in the mobile flat section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('mobile-flat');
    const link = screen.getByRole('link', { name: 'Service Page' });
    expect(flatSection).not.toContainElement(link);
  });

  it('service entry link is not in the mobile products section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('mobile-products');
    const link = screen.getByRole('link', { name: 'Service Page' });
    expect(productsSection).not.toContainElement(link);
  });

  it('service entry link has the correct href in mobile nav', () => {
    render(<MobileNav links={[SERVICE_ENTRY]} />);
    expect(screen.getByRole('link', { name: 'Service Page' })).toHaveAttribute('href', '/service-page');
  });
});

describe('MobileNav renderer – hidden entries', () => {
  it('hidden entry does not appear in the mobile flat section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const flatSection = screen.getByTestId('mobile-flat');
    expect(flatSection.querySelectorAll('a')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'Hidden Page' })]),
    );
  });

  it('hidden entry does not appear in the mobile products section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const productsSection = screen.getByTestId('mobile-products');
    expect(productsSection.querySelectorAll('a')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'Hidden Page' })]),
    );
  });

  it('hidden entry does not appear in the mobile services section', () => {
    render(<MobileNav links={MIXED_ENTRIES} />);
    const servicesSection = screen.getByTestId('mobile-services');
    expect(servicesSection.querySelectorAll('a')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ textContent: 'Hidden Page' })]),
    );
  });

  it('hidden entry alone produces three empty mobile sections', () => {
    render(<MobileNav links={[HIDDEN_ENTRY]} />);
    expect(screen.getByTestId('mobile-flat').children).toHaveLength(0);
    expect(screen.getByTestId('mobile-products').children).toHaveLength(0);
    expect(screen.getByTestId('mobile-services').children).toHaveLength(0);
  });
});

// ── MobileNav cross-section integrity against real PAGE_LINKS ─────────────────

describe('real PAGE_LINKS – mobile cross-section integrity', () => {
  it('every flat PAGE_LINKS entry renders in the mobile flat section and not in products/services', () => {
    const flatEntries = PAGE_LINKS.filter((l) => l.group === 'flat');
    render(<MobileNav links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('mobile-flat');
    const productsSection = screen.getByTestId('mobile-products');
    const servicesSection = screen.getByTestId('mobile-services');

    for (const entry of flatEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(flatSection).toContainElement(link);
      expect(productsSection).not.toContainElement(link);
      expect(servicesSection).not.toContainElement(link);
    }
  });

  it('every product PAGE_LINKS entry renders in the mobile products section and not in flat/services', () => {
    const productEntries = PAGE_LINKS.filter((l) => l.group === 'product');
    render(<MobileNav links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('mobile-flat');
    const productsSection = screen.getByTestId('mobile-products');
    const servicesSection = screen.getByTestId('mobile-services');

    for (const entry of productEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(productsSection).toContainElement(link);
      expect(flatSection).not.toContainElement(link);
      expect(servicesSection).not.toContainElement(link);
    }
  });

  it('every service PAGE_LINKS entry renders in the mobile services section and not in flat/products', () => {
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    render(<MobileNav links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('mobile-flat');
    const productsSection = screen.getByTestId('mobile-products');
    const servicesSection = screen.getByTestId('mobile-services');

    for (const entry of serviceEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(servicesSection).toContainElement(link);
      expect(flatSection).not.toContainElement(link);
      expect(productsSection).not.toContainElement(link);
    }
  });

  it('no hidden PAGE_LINKS entry appears in any mobile section', () => {
    const hiddenEntries = PAGE_LINKS.filter((l) => l.group === 'hidden');
    render(<MobileNav links={PAGE_LINKS} />);

    for (const entry of hiddenEntries) {
      const mobileFlat     = screen.getByTestId('mobile-flat').querySelectorAll(`a[href="${entry.href}"]`);
      const mobileProducts = screen.getByTestId('mobile-products').querySelectorAll(`a[href="${entry.href}"]`);
      const mobileServices = screen.getByTestId('mobile-services').querySelectorAll(`a[href="${entry.href}"]`);

      expect(mobileFlat.length).toBe(0);
      expect(mobileProducts.length).toBe(0);
      expect(mobileServices.length).toBe(0);
    }
  });

  it('mobile flat section count matches the number of flat PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'flat').length;
    render(<MobileNav links={PAGE_LINKS} />);
    expect(screen.getByTestId('mobile-flat').children).toHaveLength(expectedCount);
  });

  it('mobile products section count matches the number of product PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'product').length;
    render(<MobileNav links={PAGE_LINKS} />);
    expect(screen.getByTestId('mobile-products').children).toHaveLength(expectedCount);
  });

  it('mobile services section count matches the number of service PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'service').length;
    render(<MobileNav links={PAGE_LINKS} />);
    expect(screen.getByTestId('mobile-services').children).toHaveLength(expectedCount);
  });
});

// ── Cross-section integrity against real PAGE_LINKS ──────────────────────────
//
// These tests catch the silent-drop scenario: a typo in `group` moves an entry
// to the wrong section (or no section at all).

describe('real PAGE_LINKS – cross-section integrity', () => {
  it('every flat PAGE_LINKS entry renders in the flat section and not in products/services', () => {
    const flatEntries = PAGE_LINKS.filter((l) => l.group === 'flat');
    render(<NavBar links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('nav-flat');
    const productsSection = screen.getByTestId('nav-products');
    const servicesSection = screen.getByTestId('nav-services');

    for (const entry of flatEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(flatSection).toContainElement(link);
      expect(productsSection).not.toContainElement(link);
      expect(servicesSection).not.toContainElement(link);
    }
  });

  it('every product PAGE_LINKS entry renders in the products section and not in flat/services', () => {
    const productEntries = PAGE_LINKS.filter((l) => l.group === 'product');
    render(<NavBar links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('nav-flat');
    const productsSection = screen.getByTestId('nav-products');
    const servicesSection = screen.getByTestId('nav-services');

    for (const entry of productEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(productsSection).toContainElement(link);
      expect(flatSection).not.toContainElement(link);
      expect(servicesSection).not.toContainElement(link);
    }
  });

  it('every service PAGE_LINKS entry renders in the services section and not in flat/products', () => {
    const serviceEntries = PAGE_LINKS.filter((l) => l.group === 'service');
    render(<NavBar links={PAGE_LINKS} />);
    const flatSection     = screen.getByTestId('nav-flat');
    const productsSection = screen.getByTestId('nav-products');
    const servicesSection = screen.getByTestId('nav-services');

    for (const entry of serviceEntries) {
      const link = screen.getByRole('link', { name: entry.labelEN });
      expect(servicesSection).toContainElement(link);
      expect(flatSection).not.toContainElement(link);
      expect(productsSection).not.toContainElement(link);
    }
  });

  it('no hidden PAGE_LINKS entry appears in any nav section', () => {
    const hiddenEntries = PAGE_LINKS.filter((l) => l.group === 'hidden');
    render(<NavBar links={PAGE_LINKS} />);

    for (const entry of hiddenEntries) {
      // Hidden pages may share a label with visible entries (e.g. "Login" label on hidden login page)
      // so we look up by href inside each section instead.
      const flatLinks     = screen.getByTestId('nav-flat').querySelectorAll(`a[href="${entry.href}"]`);
      const productLinks  = screen.getByTestId('nav-products').querySelectorAll(`a[href="${entry.href}"]`);
      const serviceLinks  = screen.getByTestId('nav-services').querySelectorAll(`a[href="${entry.href}"]`);

      expect(flatLinks.length).toBe(0);
      expect(productLinks.length).toBe(0);
      expect(serviceLinks.length).toBe(0);
    }
  });

  it('flat section count matches the number of flat PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'flat').length;
    render(<NavBar links={PAGE_LINKS} />);
    expect(screen.getByTestId('nav-flat').children).toHaveLength(expectedCount);
  });

  it('products section count matches the number of product PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'product').length;
    render(<NavBar links={PAGE_LINKS} />);
    expect(screen.getByTestId('nav-products').children).toHaveLength(expectedCount);
  });

  it('services section count matches the number of service PAGE_LINKS entries', () => {
    const expectedCount = PAGE_LINKS.filter((l) => l.group === 'service').length;
    render(<NavBar links={PAGE_LINKS} />);
    expect(screen.getByTestId('nav-services').children).toHaveLength(expectedCount);
  });
});

// ── MobileNavWithLocation renderer (mirrors Navigation.tsx active-state logic) ─
//
// Applies "text-primary" to the link whose href matches `location`, exactly as
// Navigation.tsx does in its mobile branch (lines 160-201).  Service links are
// excluded from active highlighting because the real component omits it there.
//
// data-testid attributes:
//   "mobile-active-flat"     — flat links with active-class applied
//   "mobile-active-products" — product links with active-class applied
//   "mobile-active-services" — service links (no active-class logic)

const ACTIVE_CLASS   = 'text-primary';
const INACTIVE_CLASS = 'text-muted-foreground';

/**
 * Mirrors the normalizePath helper in Navigation.tsx:
 * strips a trailing slash unless the path is the bare root "/".
 */
function normalizePath(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

function MobileNavWithLocation({
  links,
  location,
}: {
  links: PageLink[];
  location: string;
}) {
  const { flat, product, service } = deriveNavArrays(links);
  // Mirror Navigation.tsx: normalise once, compare everywhere.
  const normalizedLocation = normalizePath(location);
  return (
    <div>
      <ul data-testid="mobile-active-flat">
        {flat.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className={normalizedLocation === l.href ? ACTIVE_CLASS : INACTIVE_CLASS}
            >
              {l.labelEN}
            </a>
          </li>
        ))}
      </ul>

      <ul data-testid="mobile-active-products">
        {product.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              className={normalizedLocation === l.href ? ACTIVE_CLASS : INACTIVE_CLASS}
            >
              {l.labelEN}
            </a>
          </li>
        ))}
      </ul>

      {/* Service links intentionally omit active-class logic, matching Navigation.tsx */}
      <ul data-testid="mobile-active-services">
        {service.map((l) => (
          <li key={l.href}>
            <a href={l.href} className={INACTIVE_CLASS}>
              {l.labelEN}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── MobileNav active-highlight tests ─────────────────────────────────────────

describe('MobileNav active-page highlight – flat link', () => {
  it('the flat link whose href matches location receives the active class', () => {
    render(<MobileNavWithLocation links={MIXED_ENTRIES} location="/flat-page" />);
    const link = screen.getByRole('link', { name: 'Flat Page' });
    expect(link).toHaveClass(ACTIVE_CLASS);
  });

  it('non-matching flat links do not receive the active class', () => {
    const extraFlat: PageLink = {
      href: '/other-flat',
      labelDE: 'Andere',
      labelEN: 'Other Flat',
      group: 'flat',
      component: Placeholder,
    };
    render(
      <MobileNavWithLocation
        links={[FLAT_ENTRY, extraFlat]}
        location="/flat-page"
      />,
    );
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveClass(ACTIVE_CLASS);
    expect(screen.getByRole('link', { name: 'Other Flat' })).not.toHaveClass(ACTIVE_CLASS);
  });
});

describe('MobileNav active-page highlight – product link', () => {
  it('the product link whose href matches location receives the active class', () => {
    render(<MobileNavWithLocation links={MIXED_ENTRIES} location="/product-page" />);
    const link = screen.getByRole('link', { name: 'Product Page' });
    expect(link).toHaveClass(ACTIVE_CLASS);
  });

  it('flat links are inactive when a product link is active', () => {
    render(<MobileNavWithLocation links={MIXED_ENTRIES} location="/product-page" />);
    expect(screen.getByRole('link', { name: 'Flat Page' })).not.toHaveClass(ACTIVE_CLASS);
  });
});

describe('MobileNav active-page highlight – no match', () => {
  it('no link has the active class when location matches nothing', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/does-not-exist" />,
    );
    const allLinks = screen.getAllByRole('link');
    for (const link of allLinks) {
      expect(link).not.toHaveClass(ACTIVE_CLASS);
    }
  });
});

// ── Trailing-slash and query-string active-highlight behaviour ────────────────
//
// MobileNavWithLocation uses the same normalizePath helper as Navigation.tsx,
// so these tests mirror the real component's behaviour end-to-end.
//
// Trailing slashes are stripped before comparison, so "/flat-page/" activates
// the "/flat-page" link.  The root "/" is left intact.
//
// Query strings are not part of the location value passed to this helper (in
// the real app, wouter's useLocation() returns only window.location.pathname).
// Passing a raw query string exposes what would happen if that contract were
// ever broken; normalizePath does not strip query strings, so the match fails.
// Real-component query-string tests live in nav-active-highlight.test.tsx.

describe('MobileNav active-page highlight – trailing slash (normalizePath applied)', () => {
  it('a flat link IS highlighted when location has a trailing slash', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/flat-page/" />,
    );
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveClass(ACTIVE_CLASS);
  });

  it('a product link IS highlighted when location has a trailing slash', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/product-page/" />,
    );
    expect(screen.getByRole('link', { name: 'Product Page' })).toHaveClass(ACTIVE_CLASS);
  });

  it('only the target link is highlighted — no other link gains the active class', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/flat-page/" />,
    );
    // Flat Page is active; Product Page and Service Page must not be.
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveClass(ACTIVE_CLASS);
    expect(screen.getByRole('link', { name: 'Product Page' })).not.toHaveClass(ACTIVE_CLASS);
  });
});

describe('MobileNav active-page highlight – query string', () => {
  // In the real Navigation.tsx, wouter's useLocation() strips the query string
  // before returning the pathname, so a URL like /product-page?ref=nav delivers
  // location === "/product-page" to the component — the active class IS applied.
  // Real-component integration tests for this contract live in
  // nav-active-highlight.test.tsx which exercises the real wouter hook.
  //
  // MobileNavWithLocation receives the location value directly.  Passing the
  // bare pathname confirms the match works; passing a raw query string confirms
  // normalizePath does not accidentally strip it (the QS remains unmatched,
  // which is correct — wouter is responsible for stripping it upstream).

  it('a flat link IS highlighted when location is the bare pathname', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/flat-page" />,
    );
    expect(screen.getByRole('link', { name: 'Flat Page' })).toHaveClass(ACTIVE_CLASS);
  });

  it('a product link IS highlighted when location is the bare pathname', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/product-page" />,
    );
    expect(screen.getByRole('link', { name: 'Product Page' })).toHaveClass(ACTIVE_CLASS);
  });

  it('a flat link is NOT highlighted when a raw query string is passed as location', () => {
    // normalizePath does not strip query strings — that is wouter's job.
    // This test confirms the helper's boundary: "/flat-page?ref=nav" does not
    // accidentally match "/flat-page".
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/flat-page?ref=nav" />,
    );
    expect(screen.getByRole('link', { name: 'Flat Page' })).not.toHaveClass(ACTIVE_CLASS);
  });

  it('a product link is NOT highlighted when a raw query string is passed as location', () => {
    render(
      <MobileNavWithLocation links={MIXED_ENTRIES} location="/product-page?ref=nav" />,
    );
    expect(screen.getByRole('link', { name: 'Product Page' })).not.toHaveClass(ACTIVE_CLASS);
  });
});
