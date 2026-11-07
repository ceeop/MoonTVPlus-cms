import { fireEvent, render, screen } from '@testing-library/react';

import M3u8OnlyToggle from './M3u8OnlyToggle';

test('exposes the M3U8 filter state and toggles in both directions', () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <M3u8OnlyToggle enabled={false} onChange={onChange} />
  );
  const toggle = screen.getByRole('switch', { name: '仅保留 M3U8 线路' });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(toggle).toHaveAccessibleDescription(
    '网页和 TVBox 统一只保留可识别的 M3U8 直链，隐藏其他格式及客户端解析站点'
  );
  toggle.focus();
  expect(toggle).toHaveFocus();
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenLastCalledWith(true);
  rerender(<M3u8OnlyToggle enabled onChange={onChange} />);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(toggle);
  expect(onChange).toHaveBeenLastCalledWith(false);
});
