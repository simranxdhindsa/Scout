package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/apyhub/scout/internal/config"
)

// s3Storage stores files in an AWS S3 bucket (or any S3-compatible store like MinIO).
// Uses the AWS REST API directly via net/http to avoid pulling in the heavy AWS SDK.
// For production, swap to the official SDK if you need multipart uploads or presigned URLs.
type s3Storage struct {
	bucket   string
	region   string
	endpoint string // optional custom endpoint for MinIO / R2
	client   *http.Client
}

// newS3Storage validates config and returns an s3Storage.
func newS3Storage(cfg *config.Config) (*s3Storage, error) {
	if cfg.StorageS3Bucket == "" {
		return nil, fmt.Errorf("STORAGE_S3_BUCKET is required when STORAGE_DRIVER=s3")
	}
	if cfg.StorageS3Region == "" {
		return nil, fmt.Errorf("STORAGE_S3_REGION is required when STORAGE_DRIVER=s3")
	}

	endpoint := cfg.StorageS3Endpoint
	if endpoint == "" {
		// Standard AWS S3 endpoint
		endpoint = fmt.Sprintf("https://%s.s3.%s.amazonaws.com", cfg.StorageS3Bucket, cfg.StorageS3Region)
	}

	return &s3Storage{
		bucket:   cfg.StorageS3Bucket,
		region:   cfg.StorageS3Region,
		endpoint: endpoint,
		client:   &http.Client{Timeout: 120 * time.Second},
	}, nil
}

// Put uploads content to S3 using a PUT request.
// NOTE: For production use the AWS SDK v2 which handles SigV4 signing, multipart,
// retries, and credential chain automatically. This implementation is a placeholder
// that shows the interface contract and requires AWS credentials in the environment
// (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) to be handled by the SDK.
func (s *s3Storage) Put(ctx context.Context, key string, r io.Reader, contentType string) (string, error) {
	body, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("read body for s3 put: %w", err)
	}

	url := fmt.Sprintf("%s/%s", s.endpoint, key)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build s3 put request: %w", err)
	}

	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	// In production: add SigV4 signing here via AWS SDK v2's signer package.
	// Example: signer.SignHTTP(ctx, creds, req, payloadHash, "s3", region, time.Now())

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("s3 put request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return "", fmt.Errorf("s3 put returned status %d for key %s", resp.StatusCode, key)
	}

	return key, nil
}

// Get downloads an object from S3.
func (s *s3Storage) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	url := fmt.Sprintf("%s/%s", s.endpoint, key)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build s3 get request: %w", err)
	}

	// In production: add SigV4 signing here.

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("s3 get request: %w", err)
	}

	if resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		return nil, fmt.Errorf("object not found: %s", key)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("s3 get returned status %d for key %s", resp.StatusCode, key)
	}

	return resp.Body, nil
}

// Delete removes an object from S3. Missing keys are not treated as errors.
func (s *s3Storage) Delete(ctx context.Context, key string) error {
	url := fmt.Sprintf("%s/%s", s.endpoint, key)

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return fmt.Errorf("build s3 delete request: %w", err)
	}

	// In production: add SigV4 signing here.

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("s3 delete request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("s3 delete returned status %d for key %s", resp.StatusCode, key)
	}

	return nil
}

// URL returns the public S3 URL for a stored object.
// If the bucket is public, this is directly accessible.
// For private buckets, generate pre-signed URLs here instead.
func (s *s3Storage) URL(key string) string {
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", s.bucket, s.region, key)
}
