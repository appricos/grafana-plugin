import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from '../testIds';
import * as api from './api';

jest.mock('./api');
const mockedApi = api as jest.Mocked<typeof api>;

describe('Components/AppConfig', () => {
  let props: AppConfigProps;

  beforeEach(() => {
    jest.resetAllMocks();

    props = {
      plugin: {
        meta: {
          id: 'appricos-pushinator-app',
          name: 'Pushinator',
          type: PluginType.app,
          enabled: false,
          jsonData: {},
        },
      },
      query: {},
    } as unknown as AppConfigProps;
  });

  test('renders the Connect form when not yet connected to Pushinator', async () => {
    mockedApi.getStatus.mockResolvedValue({ connected: false });

    render(<AppConfig {...props} />);

    await waitFor(() => expect(screen.getByTestId(testIds.appConfig.connectTokenInput)).toBeInTheDocument());
    expect(screen.getByTestId(testIds.appConfig.connectButton)).toBeInTheDocument();
    expect(screen.queryByText(/notification prefix/i)).not.toBeInTheDocument();
  });

  test('renders status, prefix and channels once connected', async () => {
    mockedApi.getStatus.mockResolvedValue({
      connected: true,
      tokenSet: true,
      tokenLast4: '6789',
      lastEventAt: null,
      notificationPrefix: '[PROD]',
    });
    mockedApi.listChannels.mockResolvedValue([
      { id: 'ch_1', name: 'Ops', topics: ['firing'], acknowledgmentEnabled: false },
    ]);

    render(<AppConfig {...props} />);

    await waitFor(() => expect(screen.getByDisplayValue('[PROD]')).toBeInTheDocument());
    expect(screen.getByText('Ops')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.appConfig.disconnectButton)).toBeInTheDocument();
  });
});
