package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/resource/httpadapter"
)

// Make sure App implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. Plugin should not implement all these interfaces - only those which are
// required for a particular task.
var (
	_ backend.CallResourceHandler   = (*App)(nil)
	_ instancemgmt.InstanceDisposer = (*App)(nil)
	_ backend.CheckHealthHandler    = (*App)(nil)
)

// App is the backend for one installation of the Pushinator app plugin. It proxies
// the frontend's Connect/Channels/Disconnect actions to pushinator-adapter's
// per-installation Grafana API, so the adapter's per-installation management
// secret is only ever handled here and in Grafana's own encrypted settings
// storage - never by any other service.
type App struct {
	backend.CallResourceHandler

	mu            sync.RWMutex
	adapterClient *adapterClient
	accountID     string
}

// appSettings is the non-secret half of this installation's plugin settings.
type appSettings struct {
	AccountID string `json:"accountId"`
}

// NewApp creates a new *App instance, one per plugin installation (Grafana calls
// this again whenever the installation's jsonData/secureJsonData changes).
func NewApp(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	var app App

	var parsed appSettings
	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &parsed); err != nil {
			return nil, fmt.Errorf("parse plugin settings: %w", err)
		}
	}
	app.accountID = parsed.AccountID
	app.adapterClient = newAdapterClient(settings.DecryptedSecureJSONData["managementSecret"])

	// Use a httpadapter (provided by the SDK) for resource calls. This allows us
	// to use a *http.ServeMux for resource calls, so we can map multiple routes
	// to CallResource without having to implement extra logic.
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	app.CallResourceHandler = httpadapter.New(mux)

	return &app, nil
}

// client returns the adapter client to use for the current request.
func (a *App) client() *adapterClient {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.adapterClient
}

func (a *App) currentAccountID() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.accountID
}

// setConnected records a freshly-registered account/secret so subsequent requests
// on this same instance are already authenticated, ahead of Grafana recreating the
// instance once the frontend persists the secret into secureJsonData.
func (a *App) setConnected(accountID string, client *adapterClient) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.accountID = accountID
	a.adapterClient = client
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created.
func (a *App) Dispose() {
	// cleanup
}

// CheckHealth handles health checks sent from Grafana to the plugin.
func (a *App) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "ok",
	}, nil
}
