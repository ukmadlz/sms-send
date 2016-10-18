$(document).on('ready', function() {
  $('form').on('submit', function(e) {
    e.preventDefault();
    $.post('/send', {
      msg: $('#message').val(),
    }, function(resp) {
      alert('Sent');
      $('#message').val('');
    });
  })
});
