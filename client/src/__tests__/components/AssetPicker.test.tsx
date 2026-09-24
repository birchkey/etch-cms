import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetPicker } from '../../components/AssetPicker';
import type { Asset } from '../../lib/api';

const list = vi.fn();
vi.mock('../../lib/api', () => ({
  assetsApi: {
    list: (...args: unknown[]) => list(...args),
    upload: vi.fn(),
    url: (key: string) => `/r2/${key}`,
  },
}));

function makeAsset(id: string, name: string): Asset {
  return {
    id,
    filename: `${id}.jpg`,
    original_name: name,
    content_type: 'image/jpeg',
    size: 1234,
    r2_key: `${id}.jpg`,
    alt_text: null,
    is_public: 0,
    created_at: 0,
  };
}

describe('AssetPicker', () => {
  beforeEach(() => {
    list.mockReset();
    list.mockResolvedValue({ data: [makeAsset('a1', 'photo.jpg')] });
  });

  it('shows a spinner while the first open is in flight, then the assets', async () => {
    let settle: (v: { data: Asset[] }) => void = () => {};
    list.mockReturnValue(new Promise(res => { settle = res; }));

    render(<AssetPicker open onClose={() => {}} onSelect={() => {}} />);

    // Derived loading must be true on the very first render, before any effect runs.
    expect(screen.queryByAltText('photo.jpg')).not.toBeInTheDocument();

    settle({ data: [makeAsset('a1', 'photo.jpg')] });
    expect(await screen.findByAltText('photo.jpg')).toBeInTheDocument();
  });

  it('does not get stuck loading when the request fails', async () => {
    list.mockRejectedValue(new Error('nope'));
    render(<AssetPicker open onClose={() => {}} onSelect={() => {}} />);
    // Settles into the empty state rather than spinning forever.
    await waitFor(() => expect(screen.getByText(/no assets/i)).toBeInTheDocument());
  });

  it('refetches and clears the selection when reopened', async () => {
    const onSelectMultiple = vi.fn();
    const { rerender } = render(
      <AssetPicker open onClose={() => {}} onSelect={() => {}} multiSelect onSelectMultiple={onSelectMultiple} />,
    );
    expect(await screen.findByAltText('photo.jpg')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByAltText('photo.jpg'));
    // The confirm button reflects the selection count.
    expect(await screen.findByRole('button', { name: 'Add 1 asset' })).toBeInTheDocument();

    rerender(<AssetPicker open={false} onClose={() => {}} onSelect={() => {}} multiSelect onSelectMultiple={onSelectMultiple} />);
    rerender(<AssetPicker open onClose={() => {}} onSelect={() => {}} multiSelect onSelectMultiple={onSelectMultiple} />);

    expect(await screen.findByAltText('photo.jpg')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    // Selection was cleared by the reopen, so the button is back to its empty label.
    expect(screen.getByRole('button', { name: 'Add assets' })).toBeDisabled();
  });
});
