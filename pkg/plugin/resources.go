package plugin

import (
	"encoding/json"
	"errors"
	"net/http"
)

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if body != nil {
		_ = json.NewEncoder(w).Encode(body)
	}
}

// writeAdapterError relays the adapter's own status code where it makes sense
// (e.g. a 401 from a stale/revoked management secret), and falls back to 502 for
// anything else (network errors, unexpected adapter responses).
func writeAdapterError(w http.ResponseWriter, err error) {
	var adapterErr *adapterError
	if errors.As(err, &adapterErr) {
		status := adapterErr.StatusCode
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, map[string]string{"error": adapterErr.Body})
		return
	}
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
}

func decodeJSON(r *http.Request, out interface{}) error {
	defer func() { _ = r.Body.Close() }()
	return json.NewDecoder(r.Body).Decode(out)
}

// requireConnected rejects a request with 428 Precondition Required if this
// installation hasn't completed Connect yet, and returns the adapter client to use
// otherwise.
func (a *App) requireConnected(w http.ResponseWriter) (*adapterClient, bool) {
	client := a.client()
	if !client.IsConnected() {
		writeJSON(w, http.StatusPreconditionRequired, map[string]string{"error": "not connected"})
		return nil, false
	}
	return client, true
}

// --- Connect ---

type connectRequest struct {
	Token string `json:"token"`
}

type connectResponse struct {
	AccountID string `json:"accountId"`
	// ManagementSecret is only set in the response to the FIRST successful
	// Connect call (bootstrap registration). The frontend must immediately
	// persist it into this plugin's own secureJsonData via Grafana's
	// /api/plugins/:id/settings endpoint and never send it anywhere else -
	// there is no backend-to-backend way for a plugin to write its own
	// installation settings, so this one hop through the admin's browser is
	// unavoidable with Grafana's current app-plugin architecture.
	ManagementSecret string `json:"managementSecret,omitempty"`
	TokenLast4       string `json:"tokenLast4,omitempty"`
}

// handleConnect bootstraps a new adapter registration on the very first Connect
// for this installation, or just updates the Pushinator token if it's already
// registered.
func (a *App) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req connectRequest
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "token is required"})
		return
	}

	client := a.client()
	accountID := a.currentAccountID()
	var newSecret string

	if !client.IsConnected() {
		reg, err := client.Register(r.Context())
		if err != nil {
			writeAdapterError(w, err)
			return
		}
		accountID = reg.AccountID
		newSecret = reg.ManagementSecret
		client = newAdapterClient(newSecret)
	}

	if err := client.SetToken(r.Context(), req.Token); err != nil {
		writeAdapterError(w, err)
		return
	}

	status, err := client.GetTokenStatus(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}

	a.setConnected(accountID, client)

	writeJSON(w, http.StatusOK, connectResponse{
		AccountID:        accountID,
		ManagementSecret: newSecret,
		TokenLast4:       status.Last4,
	})
}

// --- Status ---

func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	client := a.client()
	if !client.IsConnected() {
		writeJSON(w, http.StatusOK, map[string]interface{}{"connected": false})
		return
	}

	tokenStatus, err := client.GetTokenStatus(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	webhookStatus, err := client.GetWebhookStatus(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	prefix, err := client.GetPrefix(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"connected":          true,
		"accountId":          a.currentAccountID(),
		"tokenSet":           tokenStatus.IsSet,
		"tokenLast4":         tokenStatus.Last4,
		"lastEventAt":        webhookStatus.LastEventAt,
		"notificationPrefix": prefix.Prefix,
	})
}

// --- Notification prefix ---

type setPrefixRequest struct {
	Prefix string `json:"prefix"`
}

// handleSetPrefix updates the single, installation-wide notification prefix.
// An empty prefix is valid and means "no prefix" - it's not defaulted to
// anything.
func (a *App) handleSetPrefix(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	var req setPrefixRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if err := client.SetPrefix(r.Context(), req.Prefix); err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"prefix": req.Prefix})
}

// --- Token update (post-connect) ---

type setTokenRequest struct {
	Token string `json:"token"`
}

func (a *App) handleSetToken(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	var req setTokenRequest
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "token is required"})
		return
	}
	if err := client.SetToken(r.Context(), req.Token); err != nil {
		writeAdapterError(w, err)
		return
	}
	status, err := client.GetTokenStatus(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"tokenLast4": status.Last4})
}

// --- Channels ---

func (a *App) handleListChannels(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	channels, err := client.ListChannels(r.Context())
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, channels)
}

func (a *App) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	var req upsertChannelRequest
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	channel, err := client.CreateChannel(r.Context(), req)
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, channel)
}

// handleAttachChannel links an already-existing Pushinator channel (identified by
// its Pushinator channel ID) instead of creating a new one. The adapter is
// responsible for validating the ID against Pushinator and returning its real
// name, so a typo'd/foreign ID surfaces as an adapter error here rather than
// silently creating a phantom local record.
func (a *App) handleAttachChannel(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	var req attachChannelRequest
	if err := decodeJSON(r, &req); err != nil || req.PushinatorChannelID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "pushinatorChannelId is required"})
		return
	}
	channel, err := client.AttachChannel(r.Context(), req)
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, channel)
}

func (a *App) handleUpdateChannel(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	var req upsertChannelRequest
	if err := decodeJSON(r, &req); err != nil || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	req.ID = r.PathValue("id")
	channel, err := client.UpdateChannel(r.Context(), req)
	if err != nil {
		writeAdapterError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, channel)
}

func (a *App) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	if err := client.DeleteChannel(r.Context(), r.PathValue("id")); err != nil {
		writeAdapterError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Disconnect ---

// handleDisconnect fully deletes this installation's data on the adapter (see
// adapterClient.Disconnect) and clears the in-memory secret so this instance
// immediately stops being able to call the adapter, ahead of Grafana recreating it
// once the frontend clears jsonData/secureJsonData.
func (a *App) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	client, ok := a.requireConnected(w)
	if !ok {
		return
	}
	if err := client.Disconnect(r.Context()); err != nil {
		writeAdapterError(w, err)
		return
	}
	a.setConnected("", newAdapterClient(""))
	w.WriteHeader(http.StatusNoContent)
}

// registerRoutes wires up all resource routes the frontend calls via
// getBackendSrv().fetch('api/plugins/<id>/resources/...').
func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /connect", a.handleConnect)
	mux.HandleFunc("GET /status", a.handleStatus)
	mux.HandleFunc("POST /token", a.handleSetToken)
	mux.HandleFunc("POST /prefix", a.handleSetPrefix)
	mux.HandleFunc("GET /channels", a.handleListChannels)
	mux.HandleFunc("POST /channels", a.handleCreateChannel)
	mux.HandleFunc("POST /channels/attach", a.handleAttachChannel)
	mux.HandleFunc("PUT /channels/{id}", a.handleUpdateChannel)
	mux.HandleFunc("DELETE /channels/{id}", a.handleDeleteChannel)
	mux.HandleFunc("POST /disconnect", a.handleDisconnect)
}
