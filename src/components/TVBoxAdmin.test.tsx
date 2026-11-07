import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import TVBoxAdmin from './TVBoxAdmin';
import TVBoxManagementSection from './TVBoxManagementSection';

const settings = {
  CatalogEnabled: true,
  Subscriptions: [
    {
      id: 'sample',
      name: '测试订阅',
      url: 'https://example.test/tv',
      enabled: true,
      updatedAt: 1,
      document: {
        sites: [
          {
            key: 'cms',
            name: '可采集站点',
            type: 1,
            api: 'https://example.test/cms',
          },
          { key: 'jar', name: '客户端插件', type: 3, api: 'csp_A' },
        ],
      },
    },
  ],
};
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ settings, enabled: true, catalogEnabled: true }),
  });
});

test('retains the entered subscription when importing fails and exposes the server error', async () => {
  render(<TVBoxAdmin />);
  await screen.findByLabelText('订阅名称');
  fireEvent.change(screen.getByLabelText('订阅名称'), {
    target: { value: '新订阅' },
  });
  fireEvent.change(screen.getByLabelText('订阅地址'), {
    target: { value: 'https://new.test/tv' },
  });
  (fetch as jest.Mock).mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: '订阅请求超时' }),
  });
  fireEvent.click(screen.getByRole('button', { name: '添加订阅' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('订阅请求超时');
  expect(screen.getByLabelText('订阅名称')).toHaveValue('新订阅');
  expect(screen.getByLabelText('订阅地址')).toHaveValue('https://new.test/tv');
});

test('saves an explicit empty selection instead of silently exporting every site', async () => {
  render(<TVBoxAdmin />);
  await screen.findByText('测试订阅');
  fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
  fireEvent.click(screen.getByRole('button', { name: '保存站点选择' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/tvbox',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'update',
          id: 'sample',
          selectedSiteKeys: [],
        }),
      })
    )
  );
});

test('ordinary accounts do not see subscription management or request admin configuration', () => {
  render(<TVBoxManagementSection role='user' />);
  expect(screen.queryByText('管理订阅与源文件')).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

test('administrators load subscription management only after expanding it in the TV panel', async () => {
  const { container } = render(<TVBoxManagementSection role='admin' />);
  expect(screen.getByText('管理订阅与源文件')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  const details = container.querySelector('details');
  if (!details) throw new Error('Management disclosure missing');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await screen.findByLabelText('订阅名称');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/admin/tvbox', { cache: 'no-store' });
});
