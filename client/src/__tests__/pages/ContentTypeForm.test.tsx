import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ContentTypeForm from '../../pages/ContentTypeForm';

const listContentTypes = vi.fn();
const getContentType = vi.fn();

vi.mock('../../lib/api', () => ({
  contentTypesApi: {
    list: () => listContentTypes(),
    get: (id: string) => getContentType(id),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../lib/settings', () => ({
  usePageTitle: () => {},
}));

function renderAt(path: string, routePattern: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePattern} element={<ContentTypeForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

const slugInput = () => screen.getByPlaceholderText('blog-post') as HTMLInputElement;

describe('ContentTypeForm slug derivation', () => {
  beforeEach(() => {
    listContentTypes.mockReset().mockResolvedValue([]);
    getContentType.mockReset();
  });

  it('tracks the name until the slug is edited by hand', async () => {
    renderAt('/content-types/new', '/content-types/:id');

    await userEvent.type(screen.getByPlaceholderText('Blog Post'), 'My Post');
    // Derived, so it is correct on the same render as the keystroke.
    expect(slugInput().value).toBe('my-post');
  });

  it('stops tracking the name once the slug is edited, and keeps the manual value', async () => {
    renderAt('/content-types/new', '/content-types/:id');

    const name = screen.getByPlaceholderText('Blog Post');
    await userEvent.type(name, 'My Post');
    expect(slugInput().value).toBe('my-post');

    await userEvent.clear(slugInput());
    await userEvent.type(slugInput(), 'custom-slug');
    expect(slugInput().value).toBe('custom-slug');

    // Further name edits must not clobber the manual slug.
    await userEvent.type(name, ' Extra');
    expect(slugInput().value).toBe('custom-slug');
  });

  it('treats an existing type as manually slugged so its slug survives a name edit', async () => {
    getContentType.mockResolvedValue({
      id: 'ct-1',
      name: 'Existing',
      slug: 'legacy-slug',
      description: null,
      preview_url: null,
      is_singleton: 0,
      fields: [],
    });

    renderAt('/content-types/ct-1', '/content-types/:id');

    await waitFor(() => expect(slugInput().value).toBe('legacy-slug'));

    await userEvent.type(screen.getByPlaceholderText('Blog Post'), ' Renamed');
    expect(slugInput().value).toBe('legacy-slug');
  });
});
