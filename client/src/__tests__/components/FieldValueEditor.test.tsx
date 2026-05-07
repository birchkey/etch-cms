import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldValueEditor } from '../../components/FieldValueEditor';
import type { Field } from '../../lib/api';

// Mock complex sub-components that require environment features not in jsdom
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: () => <div data-testid="rich-text-editor" />,
}));
vi.mock('../../components/AssetPicker', () => ({
  AssetPicker: () => null,
}));

function makeField(overrides: Partial<Field>): Field {
  return {
    id: 'field-1',
    content_type_id: 'ct-1',
    name: 'Test Field',
    slug: 'test_field',
    type: 'text',
    required: 0,
    sort_order: 0,
    relation_content_type_id: null,
    relation_cardinality: null,
    multiple: 0,
    rich_text_extensions: null,
    select_options: null,
    min_length: null,
    max_length: null,
    min_value: null,
    max_value: null,
    pattern: null,
    phone_format: null,
    repeater_subfields: null,
    created_at: 0,
    ...overrides,
  };
}

describe('FieldValueEditor — text field', () => {
  it('renders an input with the current value', () => {
    render(<FieldValueEditor field={makeField({ type: 'text' })} value="hello" onChange={() => {}} />);
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('calls onChange when the user types', async () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={makeField({ type: 'text' })} value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('FieldValueEditor — number field', () => {
  it('renders a number input', () => {
    render(<FieldValueEditor field={makeField({ type: 'number' })} value={42} onChange={() => {}} />);
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('calls onChange with a number when the user types', async () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={makeField({ type: 'number' })} value={null} onChange={onChange} />);
    await userEvent.type(screen.getByRole('spinbutton'), '7');
    expect(onChange).toHaveBeenCalledWith(7);
  });
});

describe('FieldValueEditor — boolean field', () => {
  it('renders a switch that reflects the current value', () => {
    render(<FieldValueEditor field={makeField({ type: 'boolean' })} value={true} onChange={() => {}} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('data-state', 'checked');
  });

  it('shows "Yes" when value is true', () => {
    render(<FieldValueEditor field={makeField({ type: 'boolean' })} value={true} onChange={() => {}} />);
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('shows "No" when value is false', () => {
    render(<FieldValueEditor field={makeField({ type: 'boolean' })} value={false} onChange={() => {}} />);
    expect(screen.getByText('No')).toBeInTheDocument();
  });
});

describe('FieldValueEditor — select field (multiple)', () => {
  const selectField = makeField({
    type: 'select',
    multiple: 1,
    select_options: JSON.stringify(['Draft', 'Review', 'Published']),
  });

  it('renders a checkbox for each option', () => {
    render(<FieldValueEditor field={selectField} value={[]} onChange={() => {}} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('checks the currently selected options', () => {
    render(<FieldValueEditor field={selectField} value={['Draft', 'Published']} onChange={() => {}} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();   // Draft
    expect(checkboxes[1]).not.toBeChecked(); // Review
    expect(checkboxes[2]).toBeChecked();   // Published
  });

  it('calls onChange with added option when checking', async () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={selectField} value={[]} onChange={onChange} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1]); // Review
    expect(onChange).toHaveBeenCalledWith(['Review']);
  });

  it('calls onChange with option removed when unchecking', async () => {
    const onChange = vi.fn();
    render(<FieldValueEditor field={selectField} value={['Draft', 'Review']} onChange={onChange} />);
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]); // uncheck Draft
    expect(onChange).toHaveBeenCalledWith(['Review']);
  });
});
