package plugin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// mockCallResourceResponseSender implements backend.CallResourceResponseSender
// for use in tests.
type mockCallResourceResponseSender struct {
	response *backend.CallResourceResponse
}

// Send sets the received *backend.CallResourceResponse to s.response
func (s *mockCallResourceResponseSender) Send(response *backend.CallResourceResponse) error {
	s.response = response
	return nil
}

// withMockAdapter points adapterBaseURL at a local httptest server for the
// duration of the test and restores the real URL afterwards.
func withMockAdapter(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	original := adapterBaseURL
	adapterBaseURL = server.URL
	t.Cleanup(func() { adapterBaseURL = original })
}

func newTestApp(t *testing.T, settings backend.AppInstanceSettings) *App {
	t.Helper()
	inst, err := NewApp(context.Background(), settings)
	if err != nil {
		t.Fatalf("new app: %s", err)
	}
	app, ok := inst.(*App)
	if !ok {
		t.Fatal("inst must be of type *App")
	}
	return app
}

func callResource(t *testing.T, app *App, method, path string, body []byte) *backend.CallResourceResponse {
	t.Helper()
	var r mockCallResourceResponseSender
	err := app.CallResource(context.Background(), &backend.CallResourceRequest{
		Method: method,
		Path:   path,
		Body:   body,
	}, &r)
	if err != nil {
		t.Fatalf("CallResource error: %s", err)
	}
	if r.response == nil {
		t.Fatal("no response received from CallResource")
	}
	return r.response
}

func TestHandleStatus_NotConnected(t *testing.T) {
	app := newTestApp(t, backend.AppInstanceSettings{})

	resp := callResource(t, app, http.MethodGet, "status", nil)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Status)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(resp.Body, &body); err != nil {
		t.Fatalf("decode response: %s", err)
	}
	if body["connected"] != false {
		t.Errorf("expected connected=false, got %v", body["connected"])
	}
}

func TestHandleConnect_BootstrapsAndSetsToken(t *testing.T) {
	var gotAuthHeader string
	withMockAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/grafana-app/register":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"accountId":        "acc_123",
				"managementSecret": "secret_abc",
			})
		case "/grafana-app/token/set":
			gotAuthHeader = r.Header.Get("Authorization")
			w.WriteHeader(http.StatusOK)
		case "/grafana-app/token/get":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"isSet": true,
				"last4": "6789",
			})
		case "/grafana-app/webhook/status/get":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"lastEventAt": nil,
			})
		case "/grafana-app/prefix/get":
			_ = json.NewEncoder(w).Encode(map[string]string{"prefix": ""})
		default:
			t.Fatalf("unexpected adapter call: %s", r.URL.Path)
		}
	})

	app := newTestApp(t, backend.AppInstanceSettings{})

	reqBody, _ := json.Marshal(connectRequest{Token: "pushinator-token-123456789"})
	resp := callResource(t, app, http.MethodPost, "connect", reqBody)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Status, resp.Body)
	}

	var out connectResponse
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		t.Fatalf("decode response: %s", err)
	}
	if out.AccountID != "acc_123" {
		t.Errorf("expected accountId acc_123, got %s", out.AccountID)
	}
	if out.ManagementSecret != "secret_abc" {
		t.Errorf("expected managementSecret to be returned on first connect, got %q", out.ManagementSecret)
	}
	if out.TokenLast4 != "6789" {
		t.Errorf("expected tokenLast4 6789, got %s", out.TokenLast4)
	}
	if gotAuthHeader != "Bearer secret_abc" {
		t.Errorf("expected token/set to be authorized with the freshly issued secret, got %q", gotAuthHeader)
	}

	// A subsequent call on the same instance should already be authenticated with
	// the secret captured during Connect, ahead of Grafana recreating the instance
	// once the frontend persists it into secureJsonData.
	resp = callResource(t, app, http.MethodGet, "status", nil)
	var status map[string]interface{}
	_ = json.Unmarshal(resp.Body, &status)
	if status["connected"] != true {
		t.Errorf("expected connected=true after Connect, got %v", status["connected"])
	}
}

func TestHandleConnect_MissingToken(t *testing.T) {
	app := newTestApp(t, backend.AppInstanceSettings{})

	resp := callResource(t, app, http.MethodPost, "connect", []byte(`{}`))
	if resp.Status != http.StatusBadRequest {
		t.Errorf("expected 400 when token is missing, got %d", resp.Status)
	}
}

func TestHandleChannels_RequireConnection(t *testing.T) {
	app := newTestApp(t, backend.AppInstanceSettings{})

	resp := callResource(t, app, http.MethodGet, "channels", nil)
	if resp.Status != http.StatusPreconditionRequired {
		t.Errorf("expected 428 when not connected, got %d", resp.Status)
	}
}

func TestHandleChannels_CRUD(t *testing.T) {
	withMockAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/grafana-app/channels/list":
			_ = json.NewEncoder(w).Encode([]Channel{{ID: "ch_1", Name: "Ops"}})
		case "/grafana-app/channels/create":
			var req upsertChannelRequest
			_ = json.NewDecoder(r.Body).Decode(&req)
			_ = json.NewEncoder(w).Encode(Channel{ID: "ch_2", Name: req.Name})
		case "/grafana-app/channels/delete":
			w.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected adapter call: %s", r.URL.Path)
		}
	})

	app := newTestApp(t, backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{"managementSecret": "secret_abc"},
	})

	resp := callResource(t, app, http.MethodGet, "channels", nil)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Status)
	}
	var channels []Channel
	if err := json.Unmarshal(resp.Body, &channels); err != nil {
		t.Fatalf("decode response: %s", err)
	}
	if len(channels) != 1 || channels[0].ID != "ch_1" {
		t.Errorf("unexpected channels list: %+v", channels)
	}

	createBody, _ := json.Marshal(upsertChannelRequest{Name: "Alerts"})
	resp = callResource(t, app, http.MethodPost, "channels", createBody)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Status)
	}

	resp = callResource(t, app, http.MethodDelete, "channels/ch_2", nil)
	if resp.Status != http.StatusNoContent {
		t.Errorf("expected 204, got %d", resp.Status)
	}
}

func TestHandleSetPrefix(t *testing.T) {
	var gotBody map[string]string
	withMockAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/grafana-app/prefix/set" {
			t.Fatalf("unexpected adapter call: %s", r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
	})

	app := newTestApp(t, backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{"managementSecret": "secret_abc"},
	})

	reqBody, _ := json.Marshal(setPrefixRequest{Prefix: "[PROD]"})
	resp := callResource(t, app, http.MethodPost, "prefix", reqBody)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Status, resp.Body)
	}
	if gotBody["prefix"] != "[PROD]" {
		t.Errorf("expected adapter to receive prefix [PROD], got %q", gotBody["prefix"])
	}

	var out map[string]string
	if err := json.Unmarshal(resp.Body, &out); err != nil {
		t.Fatalf("decode response: %s", err)
	}
	if out["prefix"] != "[PROD]" {
		t.Errorf("expected response prefix [PROD], got %q", out["prefix"])
	}
}

func TestHandleAttachChannel(t *testing.T) {
	withMockAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/grafana-app/channels/attach" {
			t.Fatalf("unexpected adapter call: %s", r.URL.Path)
		}
		var req attachChannelRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.PushinatorChannelID != "existing_ch_1" {
			t.Errorf("expected pushinatorChannelId existing_ch_1, got %q", req.PushinatorChannelID)
		}
		_ = json.NewEncoder(w).Encode(Channel{ID: "existing_ch_1", Name: "Ops (from Pushinator)"})
	})

	app := newTestApp(t, backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{"managementSecret": "secret_abc"},
	})

	reqBody, _ := json.Marshal(attachChannelRequest{PushinatorChannelID: "existing_ch_1", Topics: []string{"firing", "resolved"}})
	resp := callResource(t, app, http.MethodPost, "channels/attach", reqBody)
	if resp.Status != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Status, resp.Body)
	}

	var channel Channel
	if err := json.Unmarshal(resp.Body, &channel); err != nil {
		t.Fatalf("decode response: %s", err)
	}
	if channel.Name != "Ops (from Pushinator)" {
		t.Errorf("expected adapter-supplied name, got %q", channel.Name)
	}
}

func TestHandleAttachChannel_MissingID(t *testing.T) {
	app := newTestApp(t, backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{"managementSecret": "secret_abc"},
	})

	resp := callResource(t, app, http.MethodPost, "channels/attach", []byte(`{}`))
	if resp.Status != http.StatusBadRequest {
		t.Errorf("expected 400 when pushinatorChannelId is missing, got %d", resp.Status)
	}
}

func TestHandleDisconnect(t *testing.T) {
	withMockAdapter(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/grafana-app/disconnect" {
			t.Fatalf("unexpected adapter call: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	})

	app := newTestApp(t, backend.AppInstanceSettings{
		DecryptedSecureJSONData: map[string]string{"managementSecret": "secret_abc"},
	})

	resp := callResource(t, app, http.MethodPost, "disconnect", nil)
	if resp.Status != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.Status)
	}

	// Once disconnected, this instance should behave as not-connected again.
	resp = callResource(t, app, http.MethodGet, "status", nil)
	var status map[string]interface{}
	_ = json.Unmarshal(resp.Body, &status)
	if status["connected"] != false {
		t.Errorf("expected connected=false after Disconnect, got %v", status["connected"])
	}
}
