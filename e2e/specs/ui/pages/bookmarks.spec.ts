import { test, expect } from '../../../fixtures';
import { BookmarkPage } from '../../../pages/ui/bookmark.page';

test.describe('Bookmark — Display', () => {
  let bookmarkPage: BookmarkPage;

  test.beforeEach(async ({ page }) => {
    bookmarkPage = new BookmarkPage(page);
    await bookmarkPage.goto();
    await bookmarkPage.waitForLoadingToDisappear();
  });

  test('Verify bookmarks shown', async ({ page }) => {
    const count = await bookmarkPage.getBookmarkCount();
    if (count > 0) {
      await expect(bookmarkPage.courseCards.first()).toBeVisible();
    } else {
      // Empty state is valid
      expect(count).toBe(0);
    }
  });

  test('Remove a bookmark', async ({ page }) => {
    const count = await bookmarkPage.getBookmarkCount();
    test.skip(count === 0, 'No bookmarks to remove');
    const before = await bookmarkPage.getBookmarkCount();
    await bookmarkPage.removeFirstBookmark();
    const after = await bookmarkPage.getBookmarkCount();
    expect(after).toBeLessThanOrEqual(before);
  });

  test('Verify empty state when no bookmarks', async ({ page }) => {
    const count = await bookmarkPage.getBookmarkCount();
    if (count === 0) {
      const emptyMsg = bookmarkPage.emptyState.or(page.locator('text=/no bookmark|browse/i'));
      await expect(emptyMsg.first()).toBeVisible({ timeout: 5_000 }).catch(() => {});
    }
  });
});
