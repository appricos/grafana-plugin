package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// adapterBaseURL is pushinator-adapter's public URL. It's a var (not a const) so
// tests can point it at a local httptest server.
var adapterBaseURL = "https://adapter.appricos.com"

// adapterClient talks to pushinator-adapter's Grafana app API (see
// pushinator-adapter/src/routes/grafana-app-api.ts). Every call is a POST, matching
// the adapter's POST-only RPC convention for this API.
type adapterClient struct {
	httpClient       *http.Client
	managementSecret string
}

func newAdapterClient(managementSecret string) *adapterClient {
	return &adapterClient{
		httpClient:       &http.Client{Timeout: 10 * time.Second},
		managementSecret: managementSecret,
	}
}

// IsConnected reports whether this client has a management secret from a previous
// successful /grafana-app/register call.
func (c *adapterClient) IsConnected() bool {
	return c.managementSecret != ""
}

// adapterError is returned when the adapter responds with a non-2xx status, so
// callers can distinguish e.g. a stale/revoked secret (401) from a transient
// failure and relay a sensible status back to the plugin frontend.
type adapterError struct {
	StatusCode int
	Body       string
}

func (e *adapterError) Error() string {
	return fmt.Sprintf("adapter returned %d: %s", e.StatusCode, e.Body)
}

func (c *adapterClient) call(ctx context.Context, path string, body, out interface{}) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, adapterBaseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.managementSecret != "" {
		req.Header.Set("Authorization", "Bearer "+c.managementSecret)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call adapter %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read adapter response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return &adapterError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}

	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode adapter response: %w", err)
		}
	}
	return nil
}

// --- Register (bootstrap, unauthenticated on the adapter side) ---

type registerResponse struct {
	AccountID        string `json:"accountId"`
	ManagementSecret string `json:"managementSecret"`
}

func (c *adapterClient) Register(ctx context.Context) (*registerResponse, error) {
	var out registerResponse
	if err := c.call(ctx, "/grafana-app/register", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// --- Notification prefix (one per installation, prepended as "<prefix> | <text>") ---

type prefixStatus struct {
	Prefix string `json:"prefix"`
}

func (c *adapterClient) SetPrefix(ctx context.Context, prefix string) error {
	return c.call(ctx, "/grafana-app/prefix/set", map[string]string{"prefix": prefix}, nil)
}

func (c *adapterClient) GetPrefix(ctx context.Context) (*prefixStatus, error) {
	var out prefixStatus
	if err := c.call(ctx, "/grafana-app/prefix/get", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// --- Pushinator account token ---

type tokenStatus struct {
	IsSet bool   `json:"isSet"`
	Last4 string `json:"last4,omitempty"`
}

func (c *adapterClient) SetToken(ctx context.Context, token string) error {
	return c.call(ctx, "/grafana-app/token/set", map[string]string{"token": token}, nil)
}

func (c *adapterClient) GetTokenStatus(ctx context.Context) (*tokenStatus, error) {
	var out tokenStatus
	if err := c.call(ctx, "/grafana-app/token/get", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// --- Channels ---

// Channel mirrors a Pushinator channel as managed through the adapter.
type Channel struct {
	ID                    string   `json:"id"`
	Name                  string   `json:"name"`
	Description           string   `json:"description,omitempty"`
	Topics                []string `json:"topics"`
	AcknowledgmentEnabled bool     `json:"acknowledgmentEnabled"`
	SubscribeURL          string   `json:"subscribeUrl,omitempty"`
	LastDeliveryStatus    string   `json:"lastDeliveryStatus,omitempty"`
}

type upsertChannelRequest struct {
	ID                    string   `json:"id,omitempty"`
	Name                  string   `json:"name"`
	Description           string   `json:"description,omitempty"`
	Topics                []string `json:"topics"`
	AcknowledgmentEnabled bool     `json:"acknowledgmentEnabled"`
}

func (c *adapterClient) ListChannels(ctx context.Context) ([]Channel, error) {
	var out []Channel
	if err := c.call(ctx, "/grafana-app/channels/list", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *adapterClient) CreateChannel(ctx context.Context, req upsertChannelRequest) (*Channel, error) {
	var out Channel
	if err := c.call(ctx, "/grafana-app/channels/create", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *adapterClient) UpdateChannel(ctx context.Context, req upsertChannelRequest) (*Channel, error) {
	var out Channel
	if err := c.call(ctx, "/grafana-app/channels/update", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *adapterClient) DeleteChannel(ctx context.Context, id string) error {
	return c.call(ctx, "/grafana-app/channels/delete", map[string]string{"id": id}, nil)
}

// attachChannelRequest links an already-existing Pushinator channel (created
// outside of Grafana, e.g. via the Pushinator console or another integration)
// instead of creating a brand new one.
type attachChannelRequest struct {
	PushinatorChannelID   string   `json:"pushinatorChannelId"`
	Topics                []string `json:"topics"`
	AcknowledgmentEnabled bool     `json:"acknowledgmentEnabled"`
}

// AttachChannel asks the adapter to validate the given Pushinator channel ID
// (fetching its real name for display) and register it for this installation,
// rather than creating a new Pushinator channel.
func (c *adapterClient) AttachChannel(ctx context.Context, req attachChannelRequest) (*Channel, error) {
	var out Channel
	if err := c.call(ctx, "/grafana-app/channels/attach", req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// --- Webhook delivery status & disconnect ---

type webhookStatus struct {
	LastEventAt *string `json:"lastEventAt"`
}

func (c *adapterClient) GetWebhookStatus(ctx context.Context) (*webhookStatus, error) {
	var out webhookStatus
	if err := c.call(ctx, "/grafana-app/webhook/status/get", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Disconnect fully deletes this installation's account, channels and delivery
// history on the adapter - a full delete rather than a status flag, matching the
// lesson learned the hard way on the Shopify vertical (a stale status flag once
// silently blocked delivery after a reinstall).
func (c *adapterClient) Disconnect(ctx context.Context) error {
	return c.call(ctx, "/grafana-app/disconnect", nil, nil)
}
