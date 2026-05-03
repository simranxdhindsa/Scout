package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/apyhub/scout/internal/config"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const (
	googleUserInfoURL = "https://www.googleapis.com/oauth2/v2/userinfo"
	oauthStateCookie  = "scout_oauth_state"
)

// GoogleProvider handles the Google OAuth 2.0 flow.
type GoogleProvider struct {
	oauthConfig *oauth2.Config
}

// GoogleUserInfo is the payload returned from Google's userinfo endpoint.
type GoogleUserInfo struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"picture"`
}

// newGoogleProvider constructs the OAuth2 config from Scout config.
func newGoogleProvider(cfg *config.Config) *GoogleProvider {
	return &GoogleProvider{
		oauthConfig: &oauth2.Config{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
			RedirectURL:  cfg.GoogleRedirectURL,
			Scopes: []string{
				"https://www.googleapis.com/auth/userinfo.email",
				"https://www.googleapis.com/auth/userinfo.profile",
			},
			Endpoint: google.Endpoint,
		},
	}
}

// AuthURL generates a Google OAuth consent URL and sets a CSRF state cookie.
func (g *GoogleProvider) AuthURL(w http.ResponseWriter) string {
	state := generateState()

	// Set state cookie — HttpOnly, SameSite=Lax, short-lived
	http.SetCookie(w, &http.Cookie{
		Name:     oauthStateCookie,
		Value:    state,
		Path:     "/",
		MaxAge:   600, // 10 minutes
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   false, // set to true behind HTTPS in production
	})

	return g.oauthConfig.AuthCodeURL(state, oauth2.AccessTypeOnline)
}

// Exchange validates the CSRF state, exchanges the auth code for a token,
// and fetches the Google user's profile.
func (g *GoogleProvider) Exchange(ctx context.Context, r *http.Request) (*GoogleUserInfo, error) {
	// Validate state cookie against query param
	cookie, err := r.Cookie(oauthStateCookie)
	if err != nil {
		return nil, fmt.Errorf("missing oauth state cookie")
	}
	if r.URL.Query().Get("state") != cookie.Value {
		return nil, fmt.Errorf("oauth state mismatch — possible CSRF")
	}

	// Exchange auth code for OAuth token
	code := r.URL.Query().Get("code")
	if code == "" {
		return nil, fmt.Errorf("missing oauth code")
	}

	token, err := g.oauthConfig.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("exchange oauth code: %w", err)
	}

	// Fetch user profile from Google
	client := g.oauthConfig.Client(ctx, token)
	resp, err := client.Get(googleUserInfoURL)
	if err != nil {
		return nil, fmt.Errorf("fetch google user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("google userinfo returned status %d", resp.StatusCode)
	}

	var info GoogleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("decode google user info: %w", err)
	}

	if info.Email == "" {
		return nil, fmt.Errorf("google did not return an email address")
	}

	return &info, nil
}

// generateState produces a cryptographically random state string for CSRF protection.
func generateState() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}
