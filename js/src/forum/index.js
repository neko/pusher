/*global Pusher*/

import { extend } from 'flarum/extend';
import app from 'flarum/app';
import DiscussionList from 'flarum/components/DiscussionList';
import DiscussionPage from 'flarum/components/DiscussionPage';
import IndexPage from 'flarum/components/IndexPage';
import Button from 'flarum/components/Button';

app.initializers.add('flarum-pusher', () => {
  if (!app.data.session.userId) return;  

  const loadPusher = new Promise((resolve) => {
    $.getScript('//cdn.jsdelivr.net/npm/pusher-js@7.0.3/dist/web/pusher.min.js', () => {
      const socket = new Pusher(app.forum.attribute('pusherKey'), {
        authEndpoint: app.forum.attribute('apiUrl') + '/pusher/auth',
        cluster: app.forum.attribute('pusherCluster'),
        auth: {
          headers: {
            'X-CSRF-Token': app.session.csrfToken
          }
        }
      });

      return resolve({
        channels: {
          main: socket.subscribe('public'),
          user: app.session.user ? socket.subscribe('private-user' + app.session.user.id()) : null
        },
        pusher: socket
      });
    });
  });

  app.pusher = loadPusher;
  app.pushedUpdates = [];

  extend(DiscussionList.prototype, 'oncreate', function() {
    app.pusher.then(binding => {
      const pusher = binding.pusher;

      pusher.bind('newPost', data => {
        const params = app.discussions.getParams();

        if (!params.q && !params.sort && !params.filter) {
          if (params.tags) {
            const tag = app.store.getBy('tags', 'slug', params.tags);

            if (data.tagIds.indexOf(tag.id()) === -1) return;
          }

          const id = String(data.discussionId);

          if ((!app.current.get('discussion') || id !== app.current.get('discussion').id()) && app.pushedUpdates.indexOf(id) === -1) {
            app.pushedUpdates.push(id);

            if (app.current.matches(IndexPage)) {
              app.setTitleCount(app.pushedUpdates.length);
            }

            m.redraw();
          }
        }
      });
    });
  });

  extend(DiscussionList.prototype, 'onremove', function () {
    app.pusher.then(binding => {
      binding.pusher.unbind('newPost');
    });
  });

  extend(DiscussionList.prototype, 'view', function(vdom) {
    if (app.pushedUpdates) {
      const count = app.pushedUpdates.length;

      if (count) {
        vdom.children.unshift(
          Button.component({
            className: 'Button Button--block DiscussionList-update',
            onclick: () => {
              this.attrs.state.refresh(false).then(() => {
                this.loadingUpdated = false;
                app.pushedUpdates = [];
                app.setTitleCount(0);
                m.redraw();
              });
              this.loadingUpdated = true;
            },
            loading: this.loadingUpdated
          }, app.translator.trans('flarum-pusher.forum.discussion_list.show_updates_text', { count }))
        );
      }
    }
  });

  // Prevent any newly-created discussions from triggering the discussion list
  // update button showing.
  // TODO: Might be better pause the response to the push updates while the
  // composer is loading? idk
  extend(DiscussionList.prototype, 'addDiscussion', function(returned, discussion) {
    const index = app.pushedUpdates.indexOf(discussion.id());

    if (index !== -1) {
      app.pushedUpdates.splice(index, 1);
    }

    if (app.current.matches(IndexPage)) {
      app.setTitleCount(app.pushedUpdates.length);
    }

    m.redraw();
  });

  extend(DiscussionPage.prototype, 'oncreate', function() {
    app.pusher.then(binding => {
      const pusher = binding.pusher;

      pusher.bind('newPost', data => {
        const id = String(data.discussionId);

        if (this.discussion && this.discussion.id() === id && this.stream) {
          const oldCount = this.discussion.commentCount();

          app.store.find('discussions', this.discussion.id()).then(() => {
            this.stream.update();

            if (!document.hasFocus()) {
              app.setTitleCount(Math.max(0, this.discussion.commentCount() - oldCount));

              $(window).one('focus', () => app.setTitleCount(0));
            }
          });
        }
      });
    });
  });

  extend(DiscussionPage.prototype, 'onremove', function () {
    app.pusher.then(binding => {
      binding.pusher.unbind('newPost');
    });
  });

  extend(IndexPage.prototype, 'actionItems', items => {
    items.remove('refresh');
  });

  app.pusher.then(binding => {
    const channels = binding.channels;

    if (channels.user) {
      channels.user.bind('notification', () => {
        app.session.user.pushAttributes({
          unreadNotificationCount: app.session.user.unreadNotificationCount() + 1,
          newNotificationCount: app.session.user.newNotificationCount() + 1
        });
        app.notifications.clear();
        m.redraw();
      });
    }
  });
});
